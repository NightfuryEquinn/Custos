/**
 * Optionally keeps the unlocked ledger keys for a few hours so a reload does not ask for
 * the passphrase again. Off by default, per device and address.
 *
 * The keys are non-extractable CryptoKeys, so page scripts cannot read them back out, but
 * the browser still writes their key material into this profile's IndexedDB files. Anyone
 * who copies the profile before the row expires can decrypt this account's data, and
 * deleting the row does not scrub the bytes immediately. The row is dropped on sign-out,
 * "Clear local data", expiry and when the switch is turned off.
 */
import { openCustosDb, reqAsPromise, STORES, txAsPromise } from "@/frontend/lib/pwa/idb";
import { ledgerKeyStore, seriesKeyStore } from "./key-store";

export const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;

/* The `ledger:` prefix is what "Clear local data" sweeps out of localStorage. */
const FLAG_KEY = "ledger:keep-unlocked";

type UnlockRow = { address: string; key: CryptoKey; seriesKey: CryptoKey; expiresAt: number };

/** Addresses that opted in on this device. */
function readFlags(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FLAG_KEY) ?? "[]") as unknown;

    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}

/** Whether this address chose to stay unlocked across reloads on this device. */
export function keepUnlockedEnabled(address: string): boolean {
  return readFlags().includes(address.toLowerCase());
}

/** Turn the choice on or off; turning it off also deletes any saved keys. */
export async function setKeepUnlocked(address: string, on: boolean): Promise<void> {
  const addr = address.toLowerCase();
  const rest = readFlags().filter((a) => a !== addr);
  try {
    localStorage.setItem(FLAG_KEY, JSON.stringify(on ? [...rest, addr] : rest));
  } catch {
    /* ignore quota / private mode */
  }
  if (on) await rememberUnlock(addr);
  else await forgetUnlock(addr);
}

/** Save the currently unlocked keys for `address`, valid for UNLOCK_TTL_MS from now. */
export async function rememberUnlock(address: string): Promise<void> {
  if (!keepUnlockedEnabled(address)) return;
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
    const addr = address.toLowerCase();
    /* Rows saved before this was opt-in, or after it was turned off, are removed. */
    if (!keepUnlockedEnabled(addr)) {
      await forgetUnlock(addr);

      return false;
    }
    const db = await openCustosDb();
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

/** Delete every expired row, including other accounts' that never boot again. */
export async function sweepExpiredUnlocks(): Promise<void> {
  try {
    const db = await openCustosDb();
    const tx = db.transaction(STORES.unlock, "readwrite");
    const store = tx.objectStore(STORES.unlock);
    const rows = await reqAsPromise<UnlockRow[]>(store.getAll());
    for (const row of rows) if (row.expiresAt <= Date.now()) store.delete(row.address);
    await txAsPromise(tx);
  } catch {
    /* ignore */
  }
}
