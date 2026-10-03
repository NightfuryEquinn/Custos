import { useEffect, useState } from "react";
import { applyOverlay, applySingletonOverlay } from "./overlay";
import { listOutbox, subscribeOutbox } from "./outbox";
import type { EntityKind, OutboxEntry } from "./types";

/*
 * Every hook below (`usePendingOverlay`/`usePendingSingletonOverlay`/
 * `useSyncStatus`/`useFailedOutboxEntries`) reads the same per-address
 * outbox snapshot on every change — one form open plus the topbar banner is
 * already 2-3 instances, and this phase adds several more overlay call sites.
 * A bare `subscribeOutbox` re-fetch per instance would turn one change into
 * N IDB reads; sharing in-flight reads for the same address collapses that
 * back to one.
 */
const inflightReads = new Map<string, Promise<OutboxEntry[]>>();
function readOutboxOnce(address: string): Promise<OutboxEntry[]> {
  let read = inflightReads.get(address);
  if (!read) {
    read = listOutbox(address).finally(() => inflightReads.delete(address));
    inflightReads.set(address, read);
  }
  return read;
}

/** Live list of this address's outbox entries, re-fetched on every change. */
export function useOutboxEntries(address: string): OutboxEntry[] {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void readOutboxOnce(address).then((list) => {
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

export function useSyncStatus(address: string) {
  const entries = useOutboxEntries(address);
  return {
    pending: entries.filter((e) => e.status === "pending" || e.status === "inflight").length,
    blocked: entries.filter((e) => e.status === "blocked").length,
    failed: entries.filter((e) => e.status === "failed").length,
    total: entries.length,
  };
}

/** How to render one list-shaped entity's pending outbox entries — see overlay.ts. */
type OverlaySpec<T extends { id: string }, W extends { id: string }> = Parameters<
  typeof applyOverlay<T, W>
>[3];

/**
 * Overlays pending creates/updates/deletes for one entity onto `base` (the
 * server-derived, already-decoded list). Returns `base` unchanged while
 * locked (no key) or while there's nothing pending for this entity.
 */
export function usePendingOverlay<T extends { id: string }, W extends { id: string }>(
  address: string,
  base: T[] | undefined,
  key: CryptoKey | null,
  spec: OverlaySpec<T, W>,
): T[] {
  const entries = useOutboxEntries(address);
  const [overlaid, setOverlaid] = useState<T[]>(base ?? []);

  useEffect(() => {
    let cancelled = false;
    if (!base) {
      setOverlaid([]);
      return;
    }
    if (!key || !entries.some((e) => e.entity === spec.entity)) {
      setOverlaid(base);
      return;
    }
    void applyOverlay(base, entries, key, spec).then((result) => {
      if (!cancelled) setOverlaid(result);
    });
    return () => {
      cancelled = true;
    };
  }, [base, entries, key, spec]);

  return overlaid;
}

/**
 * Overlays the newest pending write for one singleton document (categories,
 * or one wallet's budgets) onto `base`. Returns `base` unchanged while
 * locked or while nothing is pending for this target.
 */
export function usePendingSingletonOverlay<T>(
  address: string,
  targetId: string,
  base: T | undefined,
  key: CryptoKey | null,
  entity: EntityKind,
  decode: (body: unknown, key: CryptoKey) => Promise<T>,
): T | undefined {
  const entries = useOutboxEntries(address);
  const [overlaid, setOverlaid] = useState<T | undefined>(base);

  useEffect(() => {
    let cancelled = false;
    if (base === undefined || !key || !entries.some((e) => e.entity === entity)) {
      setOverlaid(base);
      return;
    }
    void applySingletonOverlay(base, entries, key, { entity, targetId, decode }).then((result) => {
      if (!cancelled) setOverlaid(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `decode` is a stable module-level function per call site
  }, [base, entries, key, entity, targetId]);

  return overlaid;
}
