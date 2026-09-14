import { useEffect, useState } from "react";
import type { Expense } from "@/frontend/lib/types";
import { listOutbox, subscribeOutbox } from "./outbox";
import { applyExpenseOverlay } from "./overlay";
import type { OutboxEntry } from "./types";

/** Live list of this address's outbox entries, re-fetched on every change. */
function useOutboxEntries(address: string): OutboxEntry[] {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void listOutbox(address).then((list) => {
        if (!cancelled) setEntries(list);
      });
    };
    load();
    const unsubscribe = subscribeOutbox(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [address]);

  return entries;
}

/**
 * Overlays pending expense creates/updates/deletes onto `base` (the
 * server-derived, already-decoded list). Returns `base` unchanged while
 * locked (no key) or while there's nothing pending.
 */
export function usePendingExpenseOverlay(
  address: string,
  base: Expense[] | undefined,
  key: CryptoKey | null,
): Expense[] {
  const entries = useOutboxEntries(address);
  const [overlaid, setOverlaid] = useState<Expense[]>(base ?? []);

  useEffect(() => {
    let cancelled = false;
    if (!base) {
      setOverlaid([]);
      return;
    }
    if (!key || !entries.some((e) => e.entity === "expense")) {
      setOverlaid(base);
      return;
    }
    void applyExpenseOverlay(base, entries, key).then((result) => {
      if (!cancelled) setOverlaid(result);
    });
    return () => {
      cancelled = true;
    };
  }, [base, entries, key]);

  return overlaid;
}

export type SyncStatus = {
  pending: number;
  blocked: number;
  failed: number;
  total: number;
};

/** Pending/blocked/failed counts for the sync-status UI. */
export function useSyncStatus(address: string): SyncStatus {
  const entries = useOutboxEntries(address);
  const pending = entries.filter((e) => e.status === "pending" || e.status === "inflight").length;
  const blocked = entries.filter((e) => e.status === "blocked").length;
  const failed = entries.filter((e) => e.status === "failed").length;

  return { pending, blocked, failed, total: entries.length };
}

/** The permanently-failed entries themselves, for a retry/discard panel. */
export function useFailedOutboxEntries(address: string): OutboxEntry[] {
  const entries = useOutboxEntries(address);
  return entries.filter((e) => e.status === "failed");
}
