/**
 * Keeps the unlocked ledger keys for a few hours so a reload does not ask for the
 * passphrase again. The keys are non-extractable CryptoKeys, stored by structured
 * clone: the raw key bytes never reach disk, and the row is dropped on sign-out,
 * "Clear local data" and expiry.
 */
import { openCustosDb, reqAsPromise, STORES, txAsPromise } from "@/frontend/lib/pwa/idb";
import { ledgerKeyStore, seriesKeyStore } from "./key-store";

export const UNLOCK_TTL_MS = 6 * 60 * 60 * 1000;

type UnlockRow = { address: string; key: CryptoKey; seriesKey: CryptoKey; expiresAt: number };

/** Save the currently unlocked keys for `address`, valid for UNLOCK_TTL_MS from now. */
export async function rememberUnlock(address: string): Promise<void> {
  const key = ledgerKeyStore.get(address);
  const seriesKey = seriesKeyStore.get(address);
  if (!key || !seriesKey) return;
  try {
    const db = await openCustosDb();
    const tx = db.transaction(STORES.unlock, "readwrite");
    const row: UnlockRow = {
      address: address.toLowerCase(),
      key,
      seriesKey,
      expiresAt: Date.now() + UNLOCK_TTL_MS,
    };
    tx.objectStore(STORES.unlock).put(row);
    await txAsPromise(tx);
  } catch {
    /* Unavailable storage just means the next load asks to unlock. */
  }
}

/** Load still-valid keys into the in-memory stores; true when the ledger is now unlocked. */
export async function restoreUnlock(address: string): Promise<boolean> {
  try {
    const db = await openCustosDb();
    const addr = address.toLowerCase();
    const row = await reqAsPromise<UnlockRow | undefined>(
      db.transaction(STORES.unlock).objectStore(STORES.unlock).get(addr),
    );
    if (!row) return false;
    if (row.expiresAt <= Date.now()) {
      await forgetUnlock(addr);

      return false;
    }
    ledgerKeyStore.set(addr, row.key);
    seriesKeyStore.set(addr, row.seriesKey);

    return true;
  } catch {
    return false;
  }
}

/** Drop the remembered keys for one address, or every address. */
export async function forgetUnlock(address?: string): Promise<void> {
  try {
    const db = await openCustosDb();
    const tx = db.transaction(STORES.unlock, "readwrite");
    const store = tx.objectStore(STORES.unlock);
    if (address) store.delete(address.toLowerCase());
    else store.clear();
    await txAsPromise(tx);
  } catch {
    /* ignore */
  }
}
