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
  try {
    await apiFetch(entry.request.path, {
      method: entry.request.method,
      body: entry.request.body,
    });
    await confirmOutbox(entry.opId);
    return "confirmed";
  } catch (err) {
    if (err instanceof ApiError && err.status === 404 && entry.op === "delete") {
      /* Already gone — a queued delete replayed after it (or a prior
         attempt whose response was lost) already landed. Success. */
      await confirmOutbox(entry.opId);
      return "confirmed";
    }
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      /* Session expired — failing every remaining queued entry individually
         would be a terrible first thing to show the user after they sign
         back in. Release this one untouched and stop the whole drain. */
      await releaseOutboxEntry(entry.opId);
      return "paused";
    }
    if (isOfflineFailure(err)) {
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
let heartbeat: ReturnType<typeof setInterval> | undefined;
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
  heartbeat = setInterval(() => {
    if (connectivity.isOnline()) trigger();
  }, 60_000);

  visibleListener = onVisible;
  triggerListener = trigger;
}

/* Held only so resetSyncTriggersForTests can remove the exact listener
   instances armSyncTriggers attached — production never calls reset, so a
   real page just attaches these once and keeps them for its lifetime. */
let triggerListener: (() => void) | null = null;
let visibleListener: (() => void) | null = null;

/** Test helper: undo armSyncTriggers' one-time guard. */
export function resetSyncTriggersForTests(): void {
  armed = false;
  currentGetAddress = null;
  clearInterval(heartbeat);
  heartbeat = undefined;
  if (triggerListener) {
    window.removeEventListener("online", triggerListener);
    window.removeEventListener("focus", triggerListener);
    triggerListener = null;
  }
  if (visibleListener) {
    document.removeEventListener("visibilitychange", visibleListener);
    visibleListener = null;
  }
}
