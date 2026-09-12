import { getClientIp, hashToken, readSessionToken } from "@/api/lib/auth";
import { tooManyRequests } from "@/api/lib/errors";
import { COLLECTIONS, getDb, isDbConnected } from "@/db";
import type { RateLimitDocument } from "@/db/collections";
import { createMiddleware } from "hono/factory";

type Bucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, Bucket>();

/** Test helper: clear in-memory rate-limit state between cases. */
export function resetRateLimitsForTests(): void {
  memoryBuckets.clear();
  lastPruneAt = Date.now();
}

/* Periodically evict expired buckets so the map cannot grow without bound. */
const PRUNE_INTERVAL_MS = 60_000;
let lastPruneAt = Date.now();

/** Evict expired in-memory rate-limit buckets. */
function pruneExpired(now: number): void {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  for (const [key, bucket] of memoryBuckets) {
    if (now >= bucket.resetAt) memoryBuckets.delete(key);
  }
}

/** In-process rate-limit check (dev / DB-unavailable fallback). */
function checkLimitMemory(key: string, limit: number, windowMs: number): number | null {
  const now = Date.now();
  pruneExpired(now);
  const bucket = memoryBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });

    return null;
  }
  if (bucket.count >= limit) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }
  bucket.count += 1;

  return null;
}

/**
 * Shared Mongo-backed rate-limit check for multi-instance (Vercel) deploys.
 * Falls back to memory when the DB is not connected yet.
 *
 * Keyed by epoch-aligned window bucket rather than "first hit in this key's
 * own window" — that turns the reset into a new document id instead of a
 * conditional update, so the whole check is one atomic `$inc` + upsert
 * instead of a read then a conditional write. The old read-then-write let
 * concurrent requests both read a below-limit count before either write
 * landed, undercounting hits.
 */
async function checkLimitMongo(
  key: string,
  limit: number,
  windowMs: number,
): Promise<number | null> {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const resetAt = new Date((bucket + 1) * windowMs);
  const col = getDb().collection<RateLimitDocument>(COLLECTIONS.rateLimits);

  const doc = await col.findOneAndUpdate(
    { _id: `${key}:${bucket}` },
    { $inc: { count: 1 }, $setOnInsert: { resetAt } },
    { upsert: true, returnDocument: "after" },
  );

  if (doc && doc.count > limit) {
    return Math.max(1, Math.ceil((doc.resetAt.getTime() - now) / 1000));
  }

  return null;
}

/** Prefer Mongo when connected so limits hold across serverless isolates. */
async function checkLimit(key: string, limit: number, windowMs: number): Promise<number | null> {
  if (isDbConnected()) {
    try {
      return await checkLimitMongo(key, limit, windowMs);
    } catch {
      /* Fall through to memory if the shared store is unavailable. */
    }
  }

  return checkLimitMemory(key, limit, windowMs);
}

type RateLimitOptions = {
  limit: number;
  windowMs: number;
  keyPrefix: string;
  keyFn?: (c: Parameters<Parameters<typeof createMiddleware>[0]>[0]) => string;
};

/**
 * IP, falling back to the (unverified) session cookie when no proxy header
 * identifies the client — every such request otherwise shares one literal
 * "unknown" bucket, so one anonymous client could rate-limit every other.
 * Cheap: hashes the raw cookie, no DB lookup or signature check.
 */
function getRateLimitSubject(c: Parameters<Parameters<typeof createMiddleware>[0]>[0]): string {
  const ip = getClientIp(c);
  if (ip !== "unknown") return ip;
  const token = readSessionToken(c);
  return token ? `session:${hashToken(token)}` : "unknown";
}

/** Build a rate-limit middleware with a fixed window and key prefix. */
function rateLimit(opts: RateLimitOptions) {
  return createMiddleware(async (c, next) => {
    const suffix = opts.keyFn ? opts.keyFn(c) : getRateLimitSubject(c);
    const key = `${opts.keyPrefix}:${suffix}`;
    const retryAfter = await checkLimit(key, opts.limit, opts.windowMs);
    if (retryAfter !== null) tooManyRequests("Too many requests. Please try again later.");
    await next();
  });
}

export const globalRateLimit = rateLimit({
  keyPrefix: "global",
  limit: 180,
  windowMs: 60_000,
});

export const authChallengeRateLimit = rateLimit({
  keyPrefix: "auth-challenge",
  limit: 12,
  windowMs: 60_000,
});

export const authVerifyRateLimit = rateLimit({
  keyPrefix: "auth-verify",
  limit: 8,
  windowMs: 60_000,
});
