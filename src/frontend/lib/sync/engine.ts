import { cacheNudgeResult, cacheNudgeDeletion } from "./nudge-cache";
import type { NudgeWire } from "@/frontend/lib/crypto/codec";
import { sendNudgeEntry } from "./nudge-check-ins";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
/**
 * Drains the offline write queue: sends each pending entry in strict `seq`
 * order (oldest first), one at a time, confirming or rescheduling per the
 * outcome. See outbox.ts for storage and types.ts for the entry shape.
 */

import { apiFetch, ApiError } from "@/frontend/lib/api";
import { isOfflineFailure } from "@/frontend/lib/net/offline-failure";
import { connectivity } from "@/frontend/lib/net/connectivity";
import { identityStorage } from "@/frontend/auth/lib/identity-storage";
import {
  claimNextOutboxEntry,
  confirmOutbox,
  failOutboxPermanently,
  purgeStaleFailures,
  scrubOutboxLabels,
  rescheduleOutbox,
  releaseOutboxEntry,
} from "./outbox";
import type { OutboxEntry } from "./types";

function errorInfo(err: unknown): { status?: number; message: string } {
  return {
    status: err instanceof ApiError ? err.status : undefined,
    message: err instanceof Error ? err.message : String(err),
  };
}

type SendOutcome = "confirmed" | "retry" | "paused" | "failed";

async function sendEntry(entry: OutboxEntry): Promise<SendOutcome> {
  if (
    (entry.entity === "nudgeCheckIn" || (entry.entity === "nudge" && entry.op !== "delete")) &&
    !ledgerKeyStore.get(entry.address)
  ) {
    await releaseOutboxEntry(entry.opId);
    return "paused";
  }
  try {
    if (entry.entity === "nudgeCheckIn" || (entry.entity === "nudge" && entry.op !== "delete")) {
      await sendNudgeEntry(entry);
    } else {
      const result = await apiFetch<{ nudge: NudgeWire }>(entry.request.path, {
        method: entry.request.method,
        body: entry.request.body,
      });
      if (entry.entity === "nudge") {
        if (entry.op === "create") await cacheNudgeResult(entry.address, result, entry.opId);
        else if (entry.op === "delete")
          await cacheNudgeDeletion(entry.address, entry.targetId, entry.opId);
      } else await confirmOutbox(entry.opId);
    }
    return "confirmed";
  } catch (err) {
    if (err instanceof ApiError && err.status === 404 && entry.op === "delete") {
      /* Already gone — a queued delete replayed after it (or a prior
         attempt whose response was lost) already landed. Success. */
      if (entry.entity === "nudge")
        await cacheNudgeDeletion(entry.address, entry.targetId, entry.opId);
      else await confirmOutbox(entry.opId);
      return "confirmed";
    }
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      /* Session expired — failing every remaining queued entry individually
         would be a terrible first thing to show the user after they sign
         back in. Release this one untouched and stop the whole drain. */
      await releaseOutboxEntry(entry.opId);
      return "paused";
    }
    if (isOfflineFailure(err) || (err instanceof ApiError && err.status === 409)) {
      await rescheduleOutbox(entry.opId, errorInfo(err));
      return "retry";
    }
    await failOutboxPermanently(entry.opId, errorInfo(err));
    return "failed";
  }
}

let draining = false;

/**
 * Drain every ready entry for `address`, oldest first, stopping on the first
 * non-terminal outcome. Refuses to run at all if `address` isn't the
 * currently signed-in identity — a defensive backstop, independent of
 * whatever called this, against ever sending one account's queued writes
 * authenticated as a different account's session cookie (see
 * `armSyncTriggers` below for the specific bug this was written to catch).
 */
export async function drainOutbox(address: string): Promise<void> {
  if (draining || !connectivity.isOnline()) return;
  const current = identityStorage.session();
  if (!current || current.toLowerCase() !== address.toLowerCase()) return;
  draining = true;
  try {
    void purgeStaleFailures(address);
    void scrubOutboxLabels(address, ledgerKeyStore.get(address));
    for (;;) {
      const entry = await claimNextOutboxEntry(address);
      if (!entry) break;
      const outcome = await sendEntry(entry);
      if (outcome === "retry" || outcome === "paused") break;
      // "confirmed" or "failed" — keep draining the rest of the queue.
    }
  } finally {
    draining = false;
  }
}

let armed = false;
/* The trigger listeners close over this indirectly (via `trigger` reading
   it fresh each call) rather than over `armSyncTriggers`'s own parameter —
   see the comment below on why that distinction is load-bearing. */
let currentGetAddress: (() => string | null) | null = null;

/**
 * Wire up the drain triggers: `online`, tab becoming visible/focused, and a
 * periodic heartbeat while online (covers a queued entry whose backoff has
 * since elapsed). No Background Sync API — iOS Safari has never shipped it,
 * and these in-page triggers cover "sync the instant the user reopens the
 * app", which is what matters for this app.
 *
 * The DOM listeners/heartbeat are attached exactly once (guarded by `armed`)
 * — but `getAddress` itself is *not* frozen at that first call. It's stored
 * in a module-level variable that every call overwrites, so a later call
 * from a fresh mount (e.g. LedgerApp remounting under a different signed-in
 * account, per its `key={account.address}`) still takes effect even though
 * the listeners themselves aren't re-attached. Getting this wrong previously
 * meant the *first* account's address was drained forever, including after
 * a different account signed in on the same tab — `drainOutbox`'s own
 * session check above is the second, independent guard against that.
 */
export function armSyncTriggers(getAddress: () => string | null): void {
  currentGetAddress = getAddress;
  if (armed || typeof window === "undefined" || typeof document === "undefined") return;
  armed = true;

  const trigger = () => {
    const address = currentGetAddress?.();
    if (address) void drainOutbox(address);
  };
  const onVisible = () => {
    if (!document.hidden) trigger();
  };

  window.addEventListener("online", trigger);
  window.addEventListener("focus", trigger);
  document.addEventListener("visibilitychange", onVisible);
  /* A probe-detected reconnect fires no `online` event; drain as soon as the store flips. */
  connectivity.subscribe(() => {
    if (connectivity.get() === "online") trigger();
  });
  setInterval(() => {
    if (connectivity.isOnline()) trigger();
  }, 60_000);
}
