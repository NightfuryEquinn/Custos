import { createApiApp } from "@/api/app";
import { resetRateLimitsForTests } from "@/api/middleware/rate-limit";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { signIn } from "../helpers/api-client";
import { installMemoryDb, uninstallMemoryDb, type MemoryDb } from "../helpers/memory-db";

const app = createApiApp();
let fetchCalls = 0;

const originalFetch = globalThis.fetch;

describe("fx routes", () => {
  let memoryDb: MemoryDb;

  beforeAll(() => {
    memoryDb = installMemoryDb();
    globalThis.fetch = (async (...args) => {
      fetchCalls++;
      return originalFetch(...args);
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    uninstallMemoryDb();
  });

  beforeEach(() => {
    resetRateLimitsForTests();
    memoryDb._reset();
    fetchCalls = 0;
    delete process.env.EXCHANGE_RATE_API_KEY;
  });

  test("rejects unsupported currency codes before upstream fetch", async () => {
    const cookie = await signIn(app);
    const res = await app.request("/api/fx/latest/ZZZ", { headers: { cookie } });

    expect(res.status).toBe(400);
    expect(fetchCalls).toBe(0);
  });

  test("accepts supported currency codes", async () => {
    process.env.EXCHANGE_RATE_API_KEY = "test-key";
    const cookie = await signIn(app);

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          result: "success",
          base_code: "USD",
          conversion_rates: { USD: 1, MYR: 4.5 },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const res = await app.request("/api/fx/latest/USD", { headers: { cookie } });
    expect(res.status).toBe(200);
  });
});
