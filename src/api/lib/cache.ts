type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

/* Periodically evict expired entries so the map cannot grow without bound —
   cacheGet only evicts the exact key it was asked for, so an entry for an
   account that never returns (e.g. a one-time profile fetch) would
   otherwise stay resident for the process lifetime. Mirrors the sweep in
   src/api/middleware/rate-limit.ts. */
const PRUNE_INTERVAL_MS = 60_000;
let lastPruneAt = Date.now();

function pruneExpired(now: number): void {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  pruneExpired(Date.now());
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheDel(key: string): void {
  store.delete(key);
}
