import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetFakeIdb } from "../helpers/fake-idb";
import { fakeLocalStorage } from "../helpers/fake-storage";
import { entry, TEST_ADDRESS as ADDRESS } from "../helpers/outbox";
import { connectivity } from "@/frontend/lib/net/connectivity";
import { enqueueOutbox, listOutbox } from "@/frontend/lib/sync/outbox";
import { identityStorage } from "@/frontend/auth/lib/identity-storage";
import { ApiError } from "@/frontend/lib/api";
import { drainOutbox } from "@/frontend/lib/sync/engine";

/* bun's test runtime has no browser localStorage — stub a minimal one, same
   convention as tests/auth/session-trust.test.ts and biometric.test.ts.
   drainOutbox refuses to run for an address that isn't the current
   `identityStorage.session()` (the cross-account-bleed backstop), so every
   test below needs that set to ADDRESS unless it's specifically testing
   the mismatch case. */

/** Stub HTTP responses without replacing the shared API module. */
function mockApi() {
  const calls: Array<{ path: string; method?: string }> = [];
  let outcomes: Array<() => Promise<unknown>> = [];
  const fetchStub = (async (input, opts) => {
    const url = new URL(String(input), "http://localhost");
    // Real API failures also trigger a connectivity probe, separate from outbox sends.
    if (url.pathname === "/manifest.webmanifest") return new Response(null, { status: 200 });
    calls.push({ path: url.pathname.slice("/api".length) + url.search, method: opts?.method });
    const next = outcomes.shift();
    try {
      return Response.json(next ? await next() : { ok: true });
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }) as typeof fetch;

  return {
    calls,
    ApiError,
    fetchStub,
    queue(fn: () => Promise<unknown>) {
      outcomes.push(fn);
    },
    reset() {
      outcomes = [];
      calls.length = 0;
    },
  };
}

const api = mockApi();

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = api.fetchStub;
  resetFakeIdb();
  api.reset();
  connectivity.setStatusForTests("online");
  // isOfflineFailure() falls back to `!navigator.onLine` — bun's bare `navigator`
  // has no `onLine` at all, which would misclassify every error as offline.
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
  (globalThis as unknown as { localStorage: unknown }).localStorage = fakeLocalStorage();
  identityStorage.setSession(ADDRESS);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  connectivity.setStatusForTests("online");
});

describe("drainOutbox", () => {
  test("confirms a successful send and removes the entry", async () => {
    await enqueueOutbox(entry());
    api.queue(async () => ({ expense: { id: "target-1" } }));

    await drainOutbox(ADDRESS);

    expect(await listOutbox(ADDRESS)).toHaveLength(0);
    expect(api.calls).toEqual([{ path: "/expenses", method: "POST" }]);
  });

  test("treats 404 on a queued delete as success", async () => {
    await enqueueOutbox(
      entry({ op: "delete", request: { method: "DELETE", path: "/expenses/target-1" } }),
    );
    api.queue(async () => {
      throw new api.ApiError(404, "Not Found");
    });

    await drainOutbox(ADDRESS);

    expect(await listOutbox(ADDRESS)).toHaveLength(0);
  });

  test("a network failure reschedules the entry and stops the drain", async () => {
    await enqueueOutbox(entry({ targetId: "a" }));
    await enqueueOutbox(entry({ targetId: "b" }));
    api.queue(async () => {
      throw new TypeError("Failed to fetch");
    });

    await drainOutbox(ADDRESS);

    const list = await listOutbox(ADDRESS);
    expect(list).toHaveLength(2); // both still queued — the drain stopped after the first failure
    expect(list[0]!.status).toBe("pending");
    expect(list[0]!.attempts).toBe(1);
    expect(api.calls).toHaveLength(1); // never attempted the second entry this pass
  });

  test("401/403 pauses the whole drain without penalizing the entry", async () => {
    await enqueueOutbox(entry({ targetId: "a" }));
    await enqueueOutbox(entry({ targetId: "b" }));
    api.queue(async () => {
      throw new api.ApiError(401, "Unauthorized");
    });

    await drainOutbox(ADDRESS);

    const list = await listOutbox(ADDRESS);
    expect(list).toHaveLength(2);
    expect(list[0]!.status).toBe("pending");
    expect(list[0]!.attempts).toBe(0); // released, not rescheduled with backoff
    expect(api.calls).toHaveLength(1);
  });

  test("a permanent failure is marked failed and the drain continues to the next entry", async () => {
    await enqueueOutbox(entry({ targetId: "a" }));
    await enqueueOutbox(entry({ targetId: "b" }));
    api.queue(async () => {
      throw new api.ApiError(400, "Bad Request");
    });
    api.queue(async () => ({ expense: { id: "b" } }));

    await drainOutbox(ADDRESS);

    const list = await listOutbox(ADDRESS);
    expect(list).toHaveLength(1); // "b" confirmed and removed
    expect(list[0]!.targetId).toBe("a");
    expect(list[0]!.status).toBe("failed");
    expect(api.calls).toHaveLength(2);
  });

  test("does nothing while offline", async () => {
    connectivity.setStatusForTests("offline");
    await enqueueOutbox(entry());

    await drainOutbox(ADDRESS);

    expect(await listOutbox(ADDRESS)).toHaveLength(1);
    expect(api.calls).toHaveLength(0);
  });

  test("refuses to drain an address that isn't the current session (cross-account bleed guard)", async () => {
    const OTHER = "0x0000000000000000000000000000000000000002";
    await enqueueOutbox(entry({ address: OTHER }));
    identityStorage.setSession(ADDRESS); // signed in as ADDRESS, not OTHER

    await drainOutbox(OTHER);

    expect(await listOutbox(OTHER)).toHaveLength(1); // untouched — never claimed, never sent
    expect(api.calls).toHaveLength(0);
  });

  test("refuses to drain with no session at all", async () => {
    await enqueueOutbox(entry());
    identityStorage.setSession(null);

    await drainOutbox(ADDRESS);

    expect(await listOutbox(ADDRESS)).toHaveLength(1);
    expect(api.calls).toHaveLength(0);
  });
});
