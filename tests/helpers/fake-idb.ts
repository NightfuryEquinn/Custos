/**
 * bun's test runtime has no IndexedDB — install the fake-indexeddb polyfill
 * (same public IDB API, in-memory) and give tests a way to fully reset it
 * between cases, since `idb.ts` caches its connection at module scope.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { resetCustosDbConnectionForTests } from "@/frontend/lib/pwa/idb";

/** Wipe the database and forget any cached connection to it. */
export function resetFakeIdb(): void {
  resetCustosDbConnectionForTests();
  // Swapping in a fresh factory is simpler and more reliable across bun/fake-indexeddb
  // versions than awaiting a real deleteDatabase() request between every test.
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}
