/**
 * Drains the offline write queue: sends each pending entry in strict `seq`
 * order (oldest first), one at a time, confirming or rescheduling per the
 * outcome. See outbox.ts for storage and types.ts for the entry shape.
 */

import { apiFetch, ApiError } from "@/frontend/lib/api";
import { isOfflineFailure } from "@/frontend/lib/net/offline-failure";
import { connectivity } from "@/frontend/lib/net/connectivity";
import {
  claimNextOutboxEntry,
  confirmOutbox,
  failOutboxPermanently,
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

/** Drain every ready entry for `address`, oldest first, stopping on the first non-terminal outcome. */
export async function drainOutbox(address: string): Promise<void> {
  if (draining || !connectivity.isOnline()) return;
  draining = true;
  try {
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

/**
 * Wire up the drain triggers: `online`, tab becoming visible/focused, and a
 * periodic heartbeat while online (covers a queued entry whose backoff has
 * since elapsed). No Background Sync API — iOS Safari has never shipped it,
 * and these in-page triggers cover "sync the instant the user reopens the
 * app", which is what matters for this app. Idempotent; call with the same
 * `getAddress` each time (e.g. once at app mount).
 */
export function armSyncTriggers(getAddress: () => string | null): void {
  if (armed || typeof window === "undefined" || typeof document === "undefined") return;
  armed = true;

  const trigger = () => {
    const address = getAddress();
    if (address) void drainOutbox(address);
  };

  window.addEventListener("online", trigger);
  window.addEventListener("focus", trigger);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) trigger();
  });
  heartbeat = setInterval(() => {
    if (connectivity.isOnline()) trigger();
  }, 60_000);
}

/** Test helper: undo armSyncTriggers' one-time guard. */
export function resetSyncTriggersForTests(): void {
  armed = false;
  clearInterval(heartbeat);
  heartbeat = undefined;
}
