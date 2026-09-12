import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { globalRateLimit, resetRateLimitsForTests } from "@/api/middleware/rate-limit";
import { Hono } from "hono";
import { installMemoryDb, uninstallMemoryDb, type MemoryDb } from "../helpers/memory-db";

/**
 * The old checkLimitMongo was a read then a conditional write: concurrent
 * requests could all read a below-limit count before any write landed,
 * letting more than `limit` requests through. The fixed-window-bucket
 * `$inc` is a single atomic op, so the counter must be exact even when every
 * request arrives at once.
 */
describe("rate limit exactness under concurrency", () => {
  let memory: MemoryDb;
  const app = new Hono();
  app.use("*", globalRateLimit);
  app.get("/", (c) => c.json({ ok: true }));

  beforeAll(() => {
    memory = installMemoryDb();
  });

  afterAll(() => {
    uninstallMemoryDb();
  });

  beforeEach(() => {
    memory._reset();
    resetRateLimitsForTests();
  });

  test("exactly `limit` requests succeed out of a larger concurrent burst", async () => {
    const TOTAL = 200; // globalRateLimit's limit is 180
    const results = await Promise.all(
      Array.from({ length: TOTAL }, () =>
        // Same IP for every call (no proxy headers) — all hit one bucket.
        app.request("/"),
      ),
    );
    const ok = results.filter((r) => r.status === 200).length;
    const limited = results.filter((r) => r.status === 429).length;

    expect(ok).toBe(180);
    expect(limited).toBe(TOTAL - 180);
  });
});
