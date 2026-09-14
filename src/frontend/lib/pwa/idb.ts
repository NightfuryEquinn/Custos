/**
 * Shared IndexedDB connection for everything the app stores locally per
 * account: the ciphertext read cache (`cipher-cache.ts`) and the offline
 * write queue (`@/frontend/lib/sync`). One database, not two — confirming a
 * queued write and refreshing its matching cached-GET row needs to happen
 * in one atomic transaction, and a sign-out/rekey wipe needs to clear both
 * stores as a single operation rather than two connections that could race.
 */

export const DB_NAME = "custos-cache";
/* v2 added the api-gets `updatedAt` index; v3 adds the `outbox` store. */
export const DB_VERSION = 3;

export const STORES = {
  apiGets: "api-gets",
  outbox: "outbox",
} as const;

let sharedDb: Promise<IDBDatabase> | null = null;

function upgrade(db: IDBDatabase, tx: IDBTransaction): void {
  const apiGets = db.objectStoreNames.contains(STORES.apiGets)
    ? tx.objectStore(STORES.apiGets)
    : db.createObjectStore(STORES.apiGets, { keyPath: "key" });
  if (!apiGets.indexNames.contains("address")) {
    apiGets.createIndex("address", "address", { unique: false });
  }
  if (!apiGets.indexNames.contains("updatedAt")) {
    apiGets.createIndex("updatedAt", "updatedAt", { unique: false });
  }

  const outbox = db.objectStoreNames.contains(STORES.outbox)
    ? tx.objectStore(STORES.outbox)
    : db.createObjectStore(STORES.outbox, { keyPath: "opId" });
  if (!outbox.indexNames.contains("address")) {
    outbox.createIndex("address", "address", { unique: false });
  }
  if (!outbox.indexNames.contains("address_seq")) {
    outbox.createIndex("address_seq", ["address", "seq"], { unique: false });
  }
  if (!outbox.indexNames.contains("status")) {
    outbox.createIndex("status", "status", { unique: false });
  }
}

/** Open (or reuse) the shared database connection. */
export function openCustosDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (!sharedDb) {
    sharedDb = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => upgrade(req.result, req.transaction!);
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => {
          sharedDb = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        sharedDb = null;
        reject(req.error ?? new Error("IndexedDB open failed"));
      };
    });
  }

  return sharedDb;
}

/** Wrap an IDBRequest as a Promise. */
export function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/** Wrap an IDBTransaction's completion as a Promise. */
export function txAsPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Test helper: forget the cached connection so the next call reopens fresh. */
export function resetCustosDbConnectionForTests(): void {
  sharedDb = null;
}
