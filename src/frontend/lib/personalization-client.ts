import { apiFetch, ApiError } from "./api";
import { ledgerKeyStore } from "./crypto/key-store";
import { encryptJson, decryptJson } from "./crypto/e2ee";
import { openCustosDb, reqAsPromise, txAsPromise, STORES } from "./pwa/idb";
import {
  emptyPersonalization,
  PERSONALIZATION_NOTICE,
  validHistoryDay,
  type PersonalizationConsent,
} from "@/lib/personalization";
import { identityStorage } from "@/frontend/auth/lib/identity-storage";

export type BehaviourEvent = {
  id: string;
  epoch: number;
  at: string;
  type: "visited" | "action" | "shown" | "opened" | "helpful" | "dismissed";
  domain: string;
  candidate?: string;
  engine: 1;
};
type Row = { id: string; day: string; epoch: number; payload: string; pending: boolean };
type State = { address: string; pref: PersonalizationConsent; available: boolean; rows: Row[] };
type ConsentResponse = {
  consent: { personalization?: PersonalizationConsent };
  available: boolean;
};
let serial = Promise.resolve();
let suppressed = 0;
export async function withoutBehaviour<T>(fn: () => Promise<T>): Promise<T> {
  suppressed++;
  try {
    return await fn();
  } finally {
    suppressed--;
  }
}
const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = serial.then(() =>
    navigator.locks ? navigator.locks.request("custos-personalization", fn) : fn(),
  );
  serial = next.then(
    () => {},
    () => {},
  );
  return next;
};
const notify = () => window.dispatchEvent(new Event("personalization-changed"));
const controlKey = (address: string) => `ledger:personalization-delete:${address.toLowerCase()}`;
async function read(address: string): Promise<State> {
  const db = await openCustosDb();
  const tx = db.transaction(STORES.personalization, "readonly");
  const state = (await reqAsPromise(
    tx.objectStore(STORES.personalization).get(address.toLowerCase()),
  )) as State | undefined;
  return (
    state ?? {
      address: address.toLowerCase(),
      pref: emptyPersonalization(),
      available: false,
      rows: [],
    }
  );
}
async function write(state: State) {
  const db = await openCustosDb();
  const tx = db.transaction(STORES.personalization, "readwrite");
  state.rows = state.rows.filter(
    (row) => validHistoryDay(row.day) && row.epoch === state.pref.epoch,
  );
  tx.objectStore(STORES.personalization).put(state);
  await txAsPromise(tx);
  notify();
}
export async function clearPersonalizationLocal(address: string) {
  return enqueue(async () => {
    const db = await openCustosDb();
    const tx = db.transaction(STORES.personalization, "readwrite");
    tx.objectStore(STORES.personalization).delete(address.toLowerCase());
    await txAsPromise(tx);
    notify();
  });
}
export async function personalSnapshot(address: string) {
  const state = await read(address);
  const key = ledgerKeyStore.get(address);
  const events: BehaviourEvent[] = [];
  if (key && state.pref.enabled && !localStorage.getItem(controlKey(address)))
    for (const row of state.rows) {
      if (!validHistoryDay(row.day) || row.epoch !== state.pref.epoch) continue;
      try {
        const event = await decryptJson<BehaviourEvent>(key, row.payload);
        if (
          event.id === row.id &&
          event.epoch === row.epoch &&
          typeof event.at === "string" &&
          event.at.slice(0, 10) === row.day &&
          typeof event.domain === "string" &&
          ["visited", "action", "shown", "opened", "helpful", "dismissed"].includes(event.type) &&
          event.engine === 1
        )
          events.push(event);
      } catch {
        /* Unreadable disposable history never breaks the ledger. */
      }
    }
  return {
    ...state,
    pref: localStorage.getItem(controlKey(address))
      ? { ...state.pref, enabled: false }
      : state.pref,
    events,
    deletionPending: !!localStorage.getItem(controlKey(address)),
  };
}
export async function syncPersonalization(address: string) {
  return enqueue(async () => {
    if (identityStorage.session()?.toLowerCase() !== address.toLowerCase() || !navigator.onLine)
      return;
    let response = await apiFetch<ConsentResponse>("/consent");
    const control = localStorage.getItem(controlKey(address));
    if (control) {
      if (control === "off")
        await apiFetch("/consent", {
          method: "PATCH",
          body: {
            personalization: {
              enabled: false,
              noticeVersion: PERSONALIZATION_NOTICE,
              expectedEpoch: response.consent.personalization?.epoch ?? 0,
            },
          },
        });
      else await apiFetch("/personalization/history", { method: "DELETE" });
      localStorage.removeItem(controlKey(address));
      response = await apiFetch<ConsentResponse>("/consent");
    }
    const state = await read(address);
    const pref = response.consent.personalization ?? emptyPersonalization();
    if (pref.epoch !== state.pref.epoch || !pref.enabled) state.rows = [];
    state.pref = pref;
    state.available = response.available;
    await write(state);
    if (!pref.enabled || !state.available || !ledgerKeyStore.get(address)) return;
    for (const day of new Set(state.rows.filter((r) => r.pending).map((r) => r.day))) {
      if (
        localStorage.getItem(controlKey(address)) ||
        identityStorage.session()?.toLowerCase() !== address.toLowerCase()
      )
        return;
      const rows = state.rows.filter((r) => r.pending && r.day === day).slice(0, 20);
      if (!validHistoryDay(day)) continue;
      try {
        const ack = await apiFetch<{ accepted: string[]; duplicate: string[]; dropped: string[] }>(
          "/personalization/history",
          {
            method: "POST",
            body: {
              epoch: pref.epoch,
              day,
              events: rows.map(({ id, payload }) => ({ id, payload })),
            },
          },
        );
        const done = new Set([...ack.accepted, ...ack.duplicate]);
        const dropped = new Set(ack.dropped);
        state.rows = state.rows
          .filter((r) => !dropped.has(r.id))
          .map((r) => (done.has(r.id) ? { ...r, pending: false } : r));
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          state.rows = [];
          state.pref = emptyPersonalization();
          await write(state);
        }
        throw error;
      }
    }
    let before: string | null = null;
    do {
      const page: {
        buckets: { day: string; events: { id: string; payload: string }[] }[];
        next: string | null;
      } = await apiFetch(`/personalization/history${before ? `?before=${before}` : ""}`);
      for (const bucket of page.buckets)
        for (const row of bucket.events)
          if (!state.rows.some((r) => r.id === row.id))
            state.rows.push({ ...row, day: bucket.day, epoch: pref.epoch, pending: false });
      before = page.next;
    } while (before);
    await write(state);
  });
}
export async function changePersonalization(address: string, enabled: boolean) {
  if (!enabled) {
    localStorage.setItem(controlKey(address), "off");
    notify();
    await clearPersonalizationLocal(address);
    await syncPersonalization(address);
    return;
  }
  await syncPersonalization(address);
  await enqueue(async () => {
    const state = await read(address);
    const response = await apiFetch<ConsentResponse>("/consent", {
      method: "PATCH",
      body: {
        personalization: {
          enabled: true,
          noticeVersion: PERSONALIZATION_NOTICE,
          expectedEpoch: state.pref.epoch,
        },
      },
    });
    state.pref = response.consent.personalization!;
    state.rows = [];
    await write(state);
  });
  await syncPersonalization(address);
}
export async function resetPersonalization(address: string) {
  localStorage.setItem(controlKey(address), "reset");
  notify();
  await clearPersonalizationLocal(address);
  await syncPersonalization(address);
}
export function recordBehaviour(
  address: string,
  type: BehaviourEvent["type"],
  domain: string,
  candidate?: string,
) {
  if (suppressed) return Promise.resolve();
  return enqueue(async () => {
    const key = ledgerKeyStore.get(address);
    if (!key || localStorage.getItem(controlKey(address))) return;
    const state = await read(address);
    if (!state.pref.enabled || !state.available) return;
    const at = new Date().toISOString(),
      day = at.slice(0, 10);
    const today = state.rows.filter((r) => r.day === day);
    if (today.length >= 60) return;
    if (type === "visited" || type === "action" || type === "shown")
      for (const row of today) {
        const previous = await decryptJson<BehaviourEvent>(key, row.payload).catch(() => null);
        if (
          previous?.type === type &&
          previous.domain === domain &&
          previous.candidate === candidate
        )
          return;
      }
    const event: BehaviourEvent = {
      id: crypto.randomUUID(),
      epoch: state.pref.epoch,
      at,
      type,
      domain,
      candidate,
      engine: 1,
    };
    const plain = { ...event, pad: "" };
    const size = new TextEncoder().encode(JSON.stringify(plain)).length;
    if (size > 512) return;
    plain.pad = " ".repeat(512 - size);
    state.rows.push({
      id: event.id,
      day,
      epoch: event.epoch,
      payload: await encryptJson(key, plain),
      pending: true,
    });
    await write(state);
  }).catch(() => {});
}
