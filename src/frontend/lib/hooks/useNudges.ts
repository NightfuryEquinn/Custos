import { api } from "@/frontend/lib/api";
import {
  decodeNudge,
  encodeNudge,
  decodeNudgeCheckIn,
  encodeNudgeCheckIn,
  type NudgeWire,
  type NudgeCheckInWire,
} from "@/frontend/lib/crypto/codec";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { drainOutbox } from "@/frontend/lib/sync/engine";
import { sealLabel } from "@/frontend/lib/sync/labels";
import { clientObjectId } from "@/frontend/lib/sync/object-id";
import { enqueueOutbox, listOutbox, discardOutbox } from "@/frontend/lib/sync/outbox";
import { useOutboxEntries } from "@/frontend/lib/sync/useOutbox";
import { applyNudgeCheckIn, type Nudge, type NudgeCheckIn } from "@/lib/nudge";
import { useEffect, useMemo, useRef, useState } from "react";
import { zonedTodayIso } from "@/lib/recurring";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type NudgesState = ReturnType<typeof useNudges>;

const keys = {
  data: (address: string) => ["nudges", address] as const,
};

/**
 * Nudges: encrypted reads and offline-queued writes. The day and timezone come from
 * Daily, which already tracks the account's clock, so the two never disagree about what
 * "today" is. Called from useLedger so nudges are cached for offline use and refreshed
 * with the rest of the ledger.
 */
export function useNudges(
  address: string,
  cryptoReady: boolean,
  timeZone: string | undefined,
  today: string | null,
) {
  const queryClient = useQueryClient();

  /** Fetch and decrypt every nudge; `fresh` skips the offline read cache. */
  const load = async (fresh = false): Promise<Nudge[]> => {
    const { nudges } = await api.nudges.list({ fresh });
    const key = ledgerKeyStore.require(address);

    return Promise.all(nudges.map((wire) => decodeNudge(wire, key)));
  };

  const query = useQuery({
    queryKey: keys.data(address),
    queryFn: () => load(),
    enabled: cryptoReady,
  });
  const key = ledgerKeyStore.get(address);
  const entries = useOutboxEntries(address);
  const pending = useMemo(
    () => entries.filter((e) => e.entity === "nudge" || e.entity === "nudgeCheckIn"),
    [entries],
  );
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [pendingEvents, setPendingEvents] = useState<NudgeCheckIn[]>([]);
  const confirmed = useRef(new Set<string>());
  const previousPending = useRef<string[]>([]);
  useEffect(() => {
    const ids = pending.map((entry) => entry.opId);
    if (previousPending.current.some((id) => !ids.includes(id)))
      void queryClient.invalidateQueries({ queryKey: keys.data(address) });
    previousPending.current = ids;
  }, [pending, address, queryClient]);
  useEffect(() => {
    let cancelled = false;
    if (!key || !query.data) return;
    void (async () => {
      const rows = new Map(query.data.map((row) => [row.id, row]));
      const events: NudgeCheckIn[] = [];
      for (const entry of pending) {
        if (confirmed.current.has(entry.opId)) continue;
        if (entry.entity === "nudge") {
          if (entry.op === "delete") {
            rows.delete(entry.targetId);
            continue;
          }
          const row = await decodeNudge(
            { ...(entry.request.body as NudgeWire), id: entry.targetId },
            key,
          );
          const previous = rows.get(row.id);
          rows.set(
            row.id,
            previous && entry.op === "update"
              ? { ...row, progress: previous.progress, history: previous.history }
              : row,
          );
        } else {
          const event = await decodeNudgeCheckIn(entry.request.body as NudgeCheckInWire, key);
          const row = rows.get(event.nudgeId);
          if (!row) continue;
          if (entry.request.method === "PUT") {
            events.push(event);
            continue;
          }
          const applied = applyNudgeCheckIn(row, event);
          rows.set(row.id, applied.nudge);
          events.push(applied.event);
        }
      }
      if (!cancelled) {
        setNudges([...rows.values()]);
        setPendingEvents(events);
      }
    })().catch(() => {
      /* Failed ciphertext stays represented by the sync error. */
    });
    return () => {
      cancelled = true;
    };
  }, [key, query.data, pending]);
  useEffect(() => {
    const synced = (event: Event) => {
      const { detail } = event as CustomEvent<{ address: string; opId: string; nudge: NudgeWire }>;
      if (detail.address !== address) return;
      confirmed.current.add(detail.opId);
      void decodeNudge(detail.nudge, ledgerKeyStore.require(address)).then((row) => {
        queryClient.setQueryData<Nudge[]>(keys.data(address), (prev) =>
          prev?.some((n) => n.id === row.id)
            ? prev.map((n) => (n.id === row.id ? row : n))
            : [...(prev ?? []), row],
        );
        void queryClient.invalidateQueries({ queryKey: ["nudge-check-ins", address] });
      });
    };
    window.addEventListener("custos:nudge-synced", synced);
    return () => window.removeEventListener("custos:nudge-synced", synced);
  }, [address, queryClient]);

  /** Insert, replace or remove rows in the cached list, so the UI answers before the queue drains. */
  const patchCache = (patch: (data: Nudge[]) => Nudge[]) =>
    queryClient.setQueryData<Nudge[]>(keys.data(address), (prev) => prev && patch(prev));

  const saveNudgeMutation = useMutation({
    mutationFn: async (data: Omit<Nudge, "id"> & { id?: string }) => {
      const cryptoKey = ledgerKeyStore.require(address);
      /* Read the zone fresh: the goal marker must name the day the tap happened on. */
      if (!timeZone) throw new Error("Nudges are not ready yet");
      const { id, ...rest } = data;
      const body = await encodeNudge(rest, cryptoKey, zonedTodayIso(timeZone));
      const labelEnc = await sealLabel(address, rest.title);

      if (id) {
        /* An edit must not reach the server before the nudge's own create. */
        const create = (await listOutbox(address)).find(
          (e) => e.entity === "nudge" && e.op === "create" && e.targetId === id,
        );
        await enqueueOutbox({
          address,
          entity: "nudge",
          op: "update",
          targetId: id,
          request: { method: "PATCH", path: `/nudges/${id}`, body },
          dependsOn: create ? [create.opId] : [],
          label: "Nudge",
          labelEnc,
        });
        void drainOutbox(address);

        return { id, ...rest };
      }

      const newId = clientObjectId();
      await enqueueOutbox({
        address,
        entity: "nudge",
        op: "create",
        targetId: newId,
        request: { method: "POST", path: "/nudges", body: { id: newId, ...body } },
        dependsOn: [],
        label: "Nudge",
        labelEnc,
      });
      void drainOutbox(address);

      return { id: newId, ...rest };
    },
    onSuccess: (saved, input) => {
      if (!input.id) patchCache((rows) => [...rows.filter((row) => row.id !== saved.id), saved]);
    },
  });

  const deleteNudgeMutation = useMutation({
    mutationFn: async (id: string) => {
      for (const entry of await listOutbox(address)) {
        if (
          entry.entity === "nudgeCheckIn" &&
          (entry.request.body as NudgeCheckInWire).nudgeId === id &&
          entry.status !== "inflight"
        )
          await discardOutbox(entry.opId);
      }
      await enqueueOutbox({
        address,
        entity: "nudge",
        op: "delete",
        targetId: id,
        request: { method: "DELETE", path: `/nudges/${id}` },
        dependsOn: [],
        label: "Delete nudge",
      });
      void drainOutbox(address);
    },
    onSuccess: (_res, id) => patchCache((data) => data.filter((n) => n.id !== id)),
  });

  const recordCheckIn = async (row: Nudge, direction: 1 | -1) => {
    if (!timeZone) throw new Error("Nudges are not ready yet");
    const day = zonedTodayIso(timeZone);
    const event: NudgeCheckIn = {
      id: clientObjectId(),
      nudgeId: row.id,
      day,
      at: new Date().toISOString(),
      change: direction * (row.step ?? 1),
      delta: 0,
      count: 0,
      target: row.target,
      unit: row.unit,
    };
    const applied = applyNudgeCheckIn(row, event);
    const create = (await listOutbox(address)).find(
      (e) => e.entity === "nudge" && e.targetId === row.id && e.op === "create",
    );
    await enqueueOutbox({
      address,
      entity: "nudgeCheckIn",
      op: "create",
      targetId: event.id,
      request: {
        method: "POST",
        path: `/nudges/${row.id}/check-ins`,
        body: await encodeNudgeCheckIn(applied.event, ledgerKeyStore.require(address)),
      },
      dependsOn: create ? [create.opId] : [],
      label: "Nudge check-in",
    });
    void drainOutbox(address);
    return applied.nudge;
  };
  const restoreCheckIn = async (event: NudgeCheckIn) => {
    const create = (await listOutbox(address)).find(
      (e) => e.entity === "nudge" && e.targetId === event.nudgeId && e.op === "create",
    );
    await enqueueOutbox({
      address,
      entity: "nudgeCheckIn",
      op: "create",
      targetId: event.id,
      request: {
        method: "PUT",
        path: `/nudges/${event.nudgeId}/check-ins/${event.id}`,
        body: await encodeNudgeCheckIn(event, ledgerKeyStore.require(address)),
      },
      dependsOn: create ? [create.opId] : [],
      label: "Nudge check-in",
    });
    void drainOutbox(address);
  };

  return {
    address,
    pendingEvents,
    recordCheckIn,
    restoreCheckIn,
    query,
    nudges,
    today,
    timeZone,
    /** Queued nudge writes, for per-card "syncing" and "couldn't save" states. */
    pending,
    /** Still fetching, or waiting a frame for the day key: not the same as unavailable. */
    loading: cryptoReady && (query.isLoading || (query.data !== undefined && today === null)),
    /** Everything Nudge needs has loaded (from the network or the offline cache). */
    ready: query.data !== undefined && !!timeZone && today !== null,
    refreshTask: { queryKey: keys.data(address), queryFn: () => load(true) },
    saveNudge: saveNudgeMutation.mutateAsync,
    deleteNudge: deleteNudgeMutation.mutateAsync,
    isSaving: saveNudgeMutation.isPending,
  };
}
