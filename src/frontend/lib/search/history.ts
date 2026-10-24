import { api } from "@/frontend/lib/api";
import {
  decodeExpense,
  decodeEvent,
  decodeVehicleFill,
  decodeNudgeCheckIn,
} from "@/frontend/lib/crypto/codec";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { connectivity } from "@/frontend/lib/net/connectivity";
import type { SearchHistory } from "./documents";

type CursorPage<T> = {
  rows: T[];
  hasMore?: boolean;
  nextBefore?: string | null;
  nextBeforeId?: string | null;
};

/** Walk every cursor, detecting broken pagination instead of reporting incomplete data as complete. */
export async function walkSearchPages<T>(
  read: (cursor: { before?: string; beforeId?: string }) => Promise<CursorPage<T>>,
  receive: (rows: T[]) => Promise<void>,
  cancelled: () => boolean,
) {
  let cursor: { before?: string; beforeId?: string } = {};
  const seen = new Set<string>();
  while (!cancelled()) {
    const page = await read(cursor);
    if (cancelled()) return;
    await receive(page.rows);
    if (!page.hasMore) return;
    const next = `${page.nextBefore}:${page.nextBeforeId}`;
    if (!page.nextBefore || seen.has(next)) throw new Error("History pagination stalled");
    seen.add(next);
    cursor = { before: page.nextBefore, beforeId: page.nextBeforeId ?? undefined };
  }
}

/** Read ciphertext through the normal cache, decrypt locally, and report progress resource by resource. */
export async function loadSearchHistory(
  address: string,
  nudgeIds: string[],
  receive: (history: Partial<SearchHistory>) => void,
  cancelled: () => boolean,
  complete: (resource: keyof SearchHistory) => void = () => {},
): Promise<string[]> {
  const key = ledgerKeyStore.require(address);
  const stopped = () => cancelled() || ledgerKeyStore.get(address) !== key;
  const unavailable: string[] = [];
  // Online reads must not silently fall back to old cached pages after an error.
  const options = { fresh: connectivity.isOnline() };
  const jobs: [string, () => Promise<void>][] = [
    [
      "transactions",
      async () => {
        await walkSearchPages(
          async (cursor) => {
            const page = await api.expenses.list({ ...cursor, limit: 2000 }, options);
            return { ...page, rows: page.expenses };
          },
          async (rows) => {
            const expenses = await Promise.all(rows.map((row) => decodeExpense(row, key)));
            if (!stopped()) receive({ expenses });
          },
          stopped,
        );
        if (!stopped()) complete("expenses");
      },
    ],
    [
      "schedule",
      async () => {
        await walkSearchPages(
          async (cursor) => {
            const page = await api.events.list({ ...cursor, limit: 2000 }, options);
            return { ...page, rows: page.events };
          },
          async (rows) => {
            const events = await Promise.all(rows.map((row) => decodeEvent(row, key)));
            if (!stopped()) receive({ events });
          },
          stopped,
        );
        if (!stopped()) complete("events");
      },
    ],
    [
      "fuel logs",
      async () => {
        await walkSearchPages(
          async (cursor) => {
            const page = await api.vehicles.fills.list({ ...cursor, limit: 2000 }, options);
            return { ...page, rows: page.fills };
          },
          async (rows) => {
            const fills = await Promise.all(rows.map((row) => decodeVehicleFill(row, key)));
            if (!stopped()) receive({ fills });
          },
          stopped,
        );
        if (!stopped()) complete("fills");
      },
    ],
    [
      "Nudge history",
      async () => {
        for (const id of nudgeIds) {
          let cursor: string | undefined;
          const seen = new Set<string>();
          do {
            if (stopped()) return;
            const page = await api.nudges.checkIns(id, { cursor }, options);
            const checkIns = await Promise.all(
              page.events.map((row) => decodeNudgeCheckIn(row, key)),
            );
            if (stopped()) return;
            receive({ checkIns });
            cursor = page.cursor ?? undefined;
            if (cursor && seen.has(cursor)) throw new Error("History pagination stalled");
            if (cursor) seen.add(cursor);
          } while (cursor);
        }
        if (!stopped()) complete("checkIns");
      },
    ],
  ];
  // Two concurrent sources keep large histories moving without flooding the API.
  let next = 0;
  const run = async () => {
    while (next < jobs.length && !stopped()) {
      const [name, job] = jobs[next++]!;
      try {
        await job();
      } catch {
        unavailable.push(name);
      }
    }
  };
  await Promise.all([run(), run()]);
  return unavailable;
}
