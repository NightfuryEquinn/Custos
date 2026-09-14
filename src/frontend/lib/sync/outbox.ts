/**
 * IndexedDB CRUD for the offline write queue, plus the coalescing rules
 * applied at enqueue time. See types.ts for the OutboxEntry shape and
 * engine.ts for how entries get drained.
 */

import { openCustosDb, STORES, reqAsPromise, txAsPromise } from "@/frontend/lib/pwa/idb";
import type { NewOutboxEntry, OutboxEntry } from "./types";

const STORE = STORES.outbox;

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to "the outbox changed" — re-render, re-fetch, whatever. */
export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}

/** All entries for an address, ordered by seq (the drain order). */
export async function listOutbox(address: string): Promise<OutboxEntry[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openCustosDb();
    const tx = db.transaction(STORE, "readonly");
    const range = IDBKeyRange.bound(
      [address.toLowerCase(), -Infinity],
      [address.toLowerCase(), Infinity],
    );
    const entries = await reqAsPromise(tx.objectStore(STORE).index("address_seq").getAll(range));
    return (entries as OutboxEntry[]).sort((a, b) => a.seq - b.seq);
  } catch {
    return [];
  }
}

/** Highest seq currently stored for an address, or -1 if none. */
async function maxSeq(tx: IDBTransaction, address: string): Promise<number> {
  const range = IDBKeyRange.bound([address, -Infinity], [address, Infinity]);
  const cursor = await reqAsPromise(
    tx.objectStore(STORE).index("address_seq").openCursor(range, "prev"),
  );
  return cursor ? (cursor.value as OutboxEntry).seq : -1;
}

/**
 * Enqueue a new entry, applying the coalescing rules against whatever is
 * already pending for the same (entity, targetId):
 *  - a new update over a pending update → replace it (keep the old seq, so
 *    order among *other* entries doesn't shift), each encode call already
 *    produces the full-shape body, so the newest simply wins.
 *  - a new delete over a pending create for the same id → drop both; the
 *    server never saw the create, so nothing needs deleting either.
 *  - a new delete over a pending update → drop the update, keep the delete.
 *  - create followed later by an update → kept as two entries (different
 *    body shapes; folding one into the other risks silent field loss).
 * Never coalesces into an entry whose status is "inflight".
 */
export async function enqueueOutbox(entry: NewOutboxEntry): Promise<OutboxEntry> {
  const db = await openCustosDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const address = entry.address.toLowerCase();

  const existingForTarget = (
    await reqAsPromise(store.index("address").getAll(IDBKeyRange.only(address)))
  ).filter(
    (e): e is OutboxEntry =>
      (e as OutboxEntry).entity === entry.entity && (e as OutboxEntry).targetId === entry.targetId,
  );

  if (entry.op === "delete") {
    const pendingCreate = existingForTarget.find(
      (e) => e.op === "create" && e.status !== "inflight",
    );
    if (pendingCreate) {
      // Never reached the server — drop the create and every queued update on it, and don't send the delete.
      for (const e of existingForTarget) {
        if (e.status !== "inflight") store.delete(e.opId);
      }
      await txAsPromise(tx);
      notify();
      return pendingCreate; // caller doesn't act on this; nothing was actually queued
    }
    for (const e of existingForTarget) {
      if (e.op === "update" && e.status !== "inflight") store.delete(e.opId);
    }
  } else if (entry.op === "update") {
    const pendingUpdate = existingForTarget.find(
      (e) => e.op === "update" && e.status !== "inflight",
    );
    if (pendingUpdate) {
      const merged: OutboxEntry = {
        ...pendingUpdate,
        request: entry.request,
        dependsOn: entry.dependsOn,
        label: entry.label ?? pendingUpdate.label,
        updatedAt: Date.now(),
      };
      store.put(merged);
      await txAsPromise(tx);
      notify();
      return merged;
    }
  }

  const seq = (await maxSeq(tx, address)) + 1;
  const now = Date.now();
  const stored: OutboxEntry = {
    ...entry,
    address,
    opId: crypto.randomUUID(),
    seq,
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
  store.put(stored);
  await txAsPromise(tx);
  notify();
  return stored;
}

/** Mark an entry's write confirmed by the server — remove it. */
export async function confirmOutbox(opId: string): Promise<void> {
  const db = await openCustosDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(opId);
  await txAsPromise(tx);
  notify();
}

/** Reschedule a retryable failure with backoff. */
export async function rescheduleOutbox(
  opId: string,
  error: { status?: number; message: string },
): Promise<void> {
  const db = await openCustosDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const existing = (await reqAsPromise(store.get(opId))) as OutboxEntry | undefined;
  if (!existing) {
    await txAsPromise(tx);
    return;
  }
  const attempts = existing.attempts + 1;
  const backoffMs = Math.min(60_000 * 2 ** (attempts - 1), 30 * 60_000);
  store.put({
    ...existing,
    status: "pending",
    attempts,
    nextAttemptAt: Date.now() + backoffMs,
    leaseUntil: undefined,
    lastError: { ...error, at: Date.now() },
    updatedAt: Date.now(),
  } satisfies OutboxEntry);
  await txAsPromise(tx);
  notify();
}

/** Mark an entry permanently failed — the drain moves on, the user must act. */
export async function failOutboxPermanently(
  opId: string,
  error: { status?: number; message: string },
): Promise<void> {
  const db = await openCustosDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const existing = (await reqAsPromise(store.get(opId))) as OutboxEntry | undefined;
  if (!existing) {
    await txAsPromise(tx);
    return;
  }
  store.put({
    ...existing,
    status: "failed",
    leaseUntil: undefined,
    lastError: { ...error, at: Date.now() },
    updatedAt: Date.now(),
  } satisfies OutboxEntry);
  await txAsPromise(tx);
  notify();
}

/** User discards a permanently-failed entry. */
export async function discardOutbox(opId: string): Promise<void> {
  return confirmOutbox(opId);
}

/** User asks to retry a permanently-failed entry. */
export async function retryOutbox(opId: string): Promise<void> {
  const db = await openCustosDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const existing = (await reqAsPromise(store.get(opId))) as OutboxEntry | undefined;
  if (!existing) {
    await txAsPromise(tx);
    return;
  }
  store.put({
    ...existing,
    status: "pending",
    nextAttemptAt: Date.now(),
    leaseUntil: undefined,
  } satisfies OutboxEntry);
  await txAsPromise(tx);
  notify();
}

/** Claim the lowest-seq pending entry ready to send, marking it inflight. */
export async function claimNextOutboxEntry(
  address: string,
  leaseMs = 60_000,
): Promise<OutboxEntry | null> {
  const db = await openCustosDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const now = Date.now();
  const range = IDBKeyRange.bound(
    [address.toLowerCase(), -Infinity],
    [address.toLowerCase(), Infinity],
  );
  const all = (
    (await reqAsPromise(store.index("address_seq").getAll(range))) as OutboxEntry[]
  ).sort((a, b) => a.seq - b.seq);

  const confirmedOrGone = new Set<string>(); // anything not in `all` is confirmed/gone
  const stillQueued = new Set(all.map((e) => e.opId));

  for (const e of all) {
    // A stale inflight lease (crashed drain, closed tab mid-request) is reclaimable.
    const eligible =
      (e.status === "pending" && e.nextAttemptAt <= now) ||
      (e.status === "inflight" && (e.leaseUntil ?? 0) < now);
    if (!eligible) continue;
    const blocked = e.dependsOn.some((dep) => stillQueued.has(dep) && !confirmedOrGone.has(dep));
    if (blocked) continue;

    const claimed: OutboxEntry = { ...e, status: "inflight", leaseUntil: now + leaseMs };
    store.put(claimed);
    await txAsPromise(tx);
    return claimed;
  }

  await txAsPromise(tx);
  return null;
}

/** Release a claimed entry back to pending without penalty (e.g. we went offline mid-claim). */
export async function releaseOutboxEntry(opId: string): Promise<void> {
  const db = await openCustosDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const existing = (await reqAsPromise(store.get(opId))) as OutboxEntry | undefined;
  if (existing) {
    store.put({ ...existing, status: "pending", leaseUntil: undefined } satisfies OutboxEntry);
  }
  await txAsPromise(tx);
}

/** Drop every entry for an address — sign-out, or after a successful rekey. */
export async function clearOutboxForAddress(address: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openCustosDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const range = IDBKeyRange.only(address.toLowerCase());
    const cursorReq = store.index("address").openCursor(range);
    await new Promise<void>((resolve, reject) => {
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("outbox clear failed"));
    });
    notify();
  } catch {
    /* ignore */
  }
}
