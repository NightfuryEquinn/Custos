import { api } from "@/frontend/lib/api";
import { decodeNudge, encodeNudge } from "@/frontend/lib/crypto/codec";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { drainOutbox } from "@/frontend/lib/sync/engine";
import { sealLabel } from "@/frontend/lib/sync/labels";
import { clientObjectId } from "@/frontend/lib/sync/object-id";
import { enqueueOutbox, listOutbox } from "@/frontend/lib/sync/outbox";
import { nudgeOverlay } from "@/frontend/lib/sync/overlay";
import { useOutboxEntries, usePendingOverlay } from "@/frontend/lib/sync/useOutbox";
import type { Nudge } from "@/lib/nudge";
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
  const nudges = usePendingOverlay(address, query.data, key, nudgeOverlay);
  const pending = useOutboxEntries(address).filter((e) => e.entity === "nudge");

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
    onSuccess: (saved) =>
      patchCache((data) =>
        data.some((n) => n.id === saved.id)
          ? data.map((n) => (n.id === saved.id ? saved : n))
          : [...data, saved],
      ),
  });

  const deleteNudgeMutation = useMutation({
    mutationFn: async (id: string) => {
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

  return {
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
