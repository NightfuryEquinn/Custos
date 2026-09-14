/**
 * IndexedDB read cache for GET /api responses, verbatim.
 * Read-only offline fallback — offline writes are queued separately, see
 * `@/frontend/lib/sync` (the outbox), which shares this same database via
 * `idb.ts`.
 *
 * Mostly ciphertext, but not entirely: a couple of endpoints intentionally
 * return plaintext alongside it — `/events` includes `notifyDetails` (title,
 * budget hold, comments) while an event's reminder is turned on, and
 * `/users` includes the account's notify email — and this cache stores
 * whatever the response body was, so those fields land here too. Cleared for
 * an address on sign-out / rekey (clearCipherCacheForAddress) and bounded by
 * ENTRY_TTL_MS / MAX_ENTRIES below.
 */

import { openCustosDb, STORES } from "./idb";

const STORE = STORES.apiGets;

/* Without these two bounds this store only ever grows: every distinct
   query-string combination (a new month, a new filter) adds a row that
   nothing but a sign-out for that exact address ever removes. */
/** Treat an entry older than this as a miss and evict it. */
const ENTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Hard cap on stored rows — oldest-by-updatedAt evicted past this. */
const MAX_ENTRIES = 500;
/** Only run the cap sweep this often; it's a full store scan. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweepAt = 0;

type CacheEntry = {
  key: string;
  address: string;
  path: string;
  body: string;
  updatedAt: number;
};

/** Build a cache key scoped to the signed-in address and API path. */
function cacheKey(address: string, path: string): string {
  return `${address.toLowerCase()}|${path}`;
}

/** Delete the oldest rows past MAX_ENTRIES. Best-effort, time-gated. */
async function sweepOverCap(db: IDBDatabase): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  try {
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("cache count failed"));
    });
    const over = count - MAX_ENTRIES;
    if (over <= 0) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.index("updatedAt").openCursor();
      let toDelete = over;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || toDelete <= 0) return;
        cursor.delete();
        toDelete--;
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("cache sweep failed"));
    });
  } catch {
    /* Best-effort — a missed sweep just tries again next call. */
  }
}

/** Persist a successful GET response body. */
export async function putCipherCache(address: string, path: string, body: unknown): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  try {
    const db = await openCustosDb();
    const entry: CacheEntry = {
      key: cacheKey(address, path),
      address: address.toLowerCase(),
      path,
      body: JSON.stringify(body),
      updatedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("cache put failed"));
    });
    void sweepOverCap(db);
  } catch {
    /* Cache is best-effort — never break the live request path. */
  }
}

/** Read a cached GET body, or null if missing or stale. */
export async function getCipherCache<T>(address: string, path: string): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;

  try {
    const db = await openCustosDb();
    const key = cacheKey(address, path);
    const entry = await new Promise<CacheEntry | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as CacheEntry | undefined);
      req.onerror = () => reject(req.error ?? new Error("cache get failed"));
    });
    if (!entry?.body) return null;
    if (Date.now() - entry.updatedAt > ENTRY_TTL_MS) {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      return null;
    }

    return JSON.parse(entry.body) as T;
  } catch {
    return null;
  }
}

/** Drop all cached GETs for one address (e.g. on sign-out). */
export async function clearCipherCacheForAddress(address: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  try {
    const db = await openCustosDb();
    const addr = address.toLowerCase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const index = store.index("address");
      const req = index.openCursor(IDBKeyRange.only(addr));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("cache clear failed"));
    });
  } catch {
    /* ignore */
  }
}
