import { sealLabel } from "@/frontend/lib/sync/labels";
import { api } from "@/frontend/lib/api";
import {
  decodeDailyCompletion,
  decodeDailyRoutine,
  encodeDailyCompletion,
  encodeDailyRoutine,
} from "@/frontend/lib/crypto/codec";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { drainOutbox } from "@/frontend/lib/sync/engine";
import { clientObjectId } from "@/frontend/lib/sync/object-id";
import { discardOutbox, enqueueOutbox, listOutbox } from "@/frontend/lib/sync/outbox";
import { dailyCompletionOverlay, dailyRoutineOverlay } from "@/frontend/lib/sync/overlay";
import { useOutboxEntries, usePendingOverlay } from "@/frontend/lib/sync/useOutbox";
import {
  currentPeriod,
  msUntilNextDay,
  type DailyCompletion,
  type DailyRoutine,
} from "@/lib/daily";
import { zonedTodayIso } from "@/lib/recurring";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export type DailyState = ReturnType<typeof useDaily>;

export type DailyData = { routines: DailyRoutine[]; completions: DailyCompletion[] };

const keys = {
  data: (address: string) => ["daily", address] as const,
  /** The account timezone decides which calendar day a period key names. */
  timezone: (address: string) => ["daily-timezone", address] as const,
};

/** Query key to invalidate when the account timezone changes, so Daily re-reads the day. */
export const dailyTimezoneKey = keys.timezone;

function requireKey(address: string): CryptoKey {
  const key = ledgerKeyStore.get(address);
  if (!key) throw new Error("Encryption key is locked");
  return key;
}

/** Today's calendar key in the account timezone, rolled over at local midnight and on app resume. */
function useToday(timeZone: string | undefined, resync: number): string | null {
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    if (!timeZone) {
      setToday(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const sync = () => {
      const now = zonedTodayIso(timeZone);
      setToday(now);
      clearTimeout(timer);
      /* A little past midnight so the day key has really changed; never spin on a tiny delay. */
      timer = setTimeout(sync, Math.max(1_000, msUntilNextDay(now, timeZone, Date.now()) + 500));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    sync();
    /* A timer pauses while a laptop sleeps, and visibilitychange is not reliable on wake:
       focus and pageshow catch the cases it misses. */
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, [timeZone, resync]);

  return today;
}

/**
 * Daily routines: encrypted reads, offline-queued writes, and the current day.
 * Called from useLedger so Daily is cached for offline use and refreshed with
 * the rest of the ledger, but kept here so the ledger hook only gains a few lines.
 */
export function useDaily(address: string, cryptoReady: boolean) {
  const queryClient = useQueryClient();

  const load = async (fresh = false): Promise<DailyData> => {
    const [{ routines }, { completions }] = await Promise.all([
      api.daily.routines.list({ fresh }),
      api.daily.completions.list({ fresh }),
    ]);
    const key = requireKey(address);

    return {
      routines: await Promise.all(routines.map((wire) => decodeDailyRoutine(wire, key))),
      completions: await Promise.all(completions.map((wire) => decodeDailyCompletion(wire, key))),
    };
  };

  const query = useQuery({
    queryKey: keys.data(address),
    queryFn: () => load(),
    enabled: cryptoReady,
  });
  const timezoneQuery = useQuery({
    queryKey: keys.timezone(address),
    queryFn: async () => (await api.users.me()).user.timezone ?? DEFAULT_TIMEZONE,
    enabled: cryptoReady,
  });
  const timeZone = timezoneQuery.data;
  const [resync, setResync] = useState(0);
  const today = useToday(timeZone, resync);

  const key = ledgerKeyStore.get(address);
  const routines = usePendingOverlay(address, query.data?.routines, key, dailyRoutineOverlay);
  const completions = usePendingOverlay(
    address,
    query.data?.completions,
    key,
    dailyCompletionOverlay,
  );
  const pending = useOutboxEntries(address).filter((e) => e.entity.startsWith("daily"));

  /** Insert or replace one row in the cached list, so the UI answers before the queue drains. */
  const patchCache = (patch: (data: DailyData) => DailyData) =>
    queryClient.setQueryData<DailyData>(keys.data(address), (prev) => prev && patch(prev));

  const saveRoutineMutation = useMutation({
    mutationFn: async (data: Omit<DailyRoutine, "id"> & { id?: string }) => {
      const cryptoKey = requireKey(address);
      const { id, ...rest } = data;
      const encrypted = await encodeDailyRoutine(rest, cryptoKey);

      if (id) {
        /* An edit or archive must not reach the server before the routine's own create. */
        const create = (await listOutbox(address)).find(
          (e) => e.entity === "dailyRoutine" && e.op === "create" && e.targetId === id,
        );
        await enqueueOutbox({
          address,
          entity: "dailyRoutine",
          op: "update",
          targetId: id,
          request: { method: "PATCH", path: `/daily/routines/${id}`, body: encrypted },
          dependsOn: create ? [create.opId] : [],
          label: "Routine",
          labelEnc: await sealLabel(address, rest.title),
        });
        void drainOutbox(address);
        return { id, ...rest };
      }

      const newId = clientObjectId();
      await enqueueOutbox({
        address,
        entity: "dailyRoutine",
        op: "create",
        targetId: newId,
        request: { method: "POST", path: "/daily/routines", body: { id: newId, ...encrypted } },
        dependsOn: [],
        label: "Routine",
        labelEnc: await sealLabel(address, rest.title),
      });
      void drainOutbox(address);
      return { id: newId, ...rest };
    },
    onSuccess: (saved) =>
      patchCache((data) => ({
        ...data,
        routines: data.routines.some((r) => r.id === saved.id)
          ? data.routines.map((r) => (r.id === saved.id ? saved : r))
          : [...data.routines, saved],
      })),
  });

  /** Delete a routine and, server-side, every completion (its points) with it. */
  const deleteRoutineMutation = useMutation({
    mutationFn: async (id: string) => {
      /* Queued check-ins that haven't been sent would 404 once the routine is gone. */
      for (const entry of await listOutbox(address)) {
        if (
          entry.entity === "dailyCompletion" &&
          entry.status !== "inflight" &&
          entry.targetId.startsWith(`${id}:`)
        ) {
          await discardOutbox(entry.opId);
        }
      }
      await enqueueOutbox({
        address,
        entity: "dailyRoutine",
        op: "delete",
        targetId: id,
        request: { method: "DELETE", path: `/daily/routines/${id}` },
        dependsOn: [],
        label: "Delete routine",
      });
      void drainOutbox(address);
    },
    onSuccess: (_res, id) =>
      patchCache((data) => ({
        routines: data.routines.filter((r) => r.id !== id),
        completions: data.completions.filter((c) => c.routineId !== id),
      })),
  });

  /**
   * Queue one checkbox state for one period. The period is fixed by the caller
   * and travels in the request, so a write that syncs after midnight still lands
   * on the day it was made.
   */
  const queueCompletion = async (
    routine: Pick<DailyRoutine, "id" | "title">,
    completion: Pick<DailyCompletion, "period" | "done" | "at">,
  ): Promise<DailyCompletion> => {
    const body = await encodeDailyCompletion(
      { routineId: routine.id, ...completion },
      requireKey(address),
    );
    /* A routine still waiting to be created must reach the server first. */
    const create = (await listOutbox(address)).find(
      (e) => e.entity === "dailyRoutine" && e.op === "create" && e.targetId === routine.id,
    );
    const id = `${routine.id}:${completion.period}`;
    await enqueueOutbox({
      address,
      entity: "dailyCompletion",
      op: "update",
      targetId: id,
      request: { method: "PUT", path: "/daily/completions", body },
      dependsOn: create ? [create.opId] : [],
      label: "Routine check-in",
      labelEnc: await sealLabel(address, routine.title),
    });
    void drainOutbox(address);

    return { id, routineId: routine.id, ...completion };
  };

  const cacheCompletion = (saved: DailyCompletion) =>
    patchCache((data) => ({
      ...data,
      completions: data.completions.some((c) => c.id === saved.id)
        ? data.completions.map((c) => (c.id === saved.id ? saved : c))
        : [...data.completions, saved],
    }));

  /** Check or uncheck a routine for the period that is due right now. */
  const setDoneMutation = useMutation({
    mutationFn: ({
      routine,
      done,
      expectedPeriod,
    }: {
      routine: DailyRoutine;
      done: boolean;
      expectedPeriod?: string;
    }) => {
      /* Read the zone fresh: a tick must be judged against the clock now, not at last render. */
      const zone = queryClient.getQueryData<string>(keys.timezone(address));
      if (!zone) throw new Error("Daily is not ready yet");
      const period = currentPeriod(routine, zonedTodayIso(zone));
      if (!period) throw new Error("This routine is not due today");
      /* The row on screen was for another day (the app slept past midnight): refresh the day
         instead of writing a different day's state than the one the person tapped. */
      if (expectedPeriod !== undefined && expectedPeriod !== period) {
        setResync((n) => n + 1);
        throw new Error("The day changed — your list has been refreshed.");
      }

      return queueCompletion(routine, { period, done, at: new Date().toISOString() });
    },
    onSuccess: cacheCompletion,
  });

  /** Write a past period's state from a restored backup (the UI itself only edits the current period). */
  const restoreCompletionMutation = useMutation({
    mutationFn: (c: Pick<DailyCompletion, "routineId" | "period" | "done" | "at">) => {
      const routine = routines.find((r) => r.id === c.routineId);

      return queueCompletion({ id: c.routineId, title: routine?.title ?? "Routine" }, c);
    },
    onSuccess: cacheCompletion,
  });

  return {
    query,
    timezoneQuery,
    /** Still fetching, or waiting a frame for the day key: not the same as unavailable. */
    loading:
      cryptoReady &&
      (query.isLoading ||
        timezoneQuery.isLoading ||
        (query.data !== undefined && !!timeZone && today === null)),
    /** Everything Daily needs has loaded (from the network or the offline cache). */
    ready: query.data !== undefined && !!timeZone && today !== null,
    routines,
    completions,
    today,
    timeZone,
    /** Queued Daily writes, for per-row "syncing" and "couldn't save" states. */
    pending,
    refreshTask: { queryKey: keys.data(address), queryFn: () => load(true) },
    saveRoutine: saveRoutineMutation.mutateAsync,
    deleteRoutine: deleteRoutineMutation.mutateAsync,
    /** `expectedPeriod` is the period of the row the person tapped; a mismatch refuses the write. */
    setDone: (routine: DailyRoutine, done: boolean, expectedPeriod?: string) =>
      setDoneMutation.mutateAsync({ routine, done, expectedPeriod }),
    restoreCompletion: restoreCompletionMutation.mutateAsync,
    /** Routine writes only; checkbox taps are instant and never disable the page. */
    isSaving: saveRoutineMutation.isPending,
  };
}
