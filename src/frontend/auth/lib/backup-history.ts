import { api } from "@/frontend/lib/api";
import { decodeEvent } from "@/frontend/lib/crypto/codec";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { walkSearchPages } from "@/frontend/lib/search/history";
import type { LedgerEvent } from "@/frontend/lib/types";

/**
 * Page every schedule event for an encrypted backup.
 * Aborts rather than silently truncating if pagination stalls.
 */
export async function loadEventsBackup(address: string): Promise<LedgerEvent[]> {
  const key = ledgerKeyStore.require(address);
  const events: LedgerEvent[] = [];

  await walkSearchPages(
    async (cursor) => {
      const page = await api.events.list({ ...cursor, limit: 2000 }, { fresh: true });

      return { ...page, rows: page.events };
    },
    async (rows) => {
      events.push(...(await Promise.all(rows.map((row) => decodeEvent(row, key)))));
    },
    () => false,
  );

  return events;
}
