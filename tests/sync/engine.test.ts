import { beforeEach, describe, expect, mock, test } from "bun:test";
import { resetFakeIdb } from "../helpers/fake-idb";
import { connectivity } from "@/frontend/lib/net/connectivity";
import { enqueueOutbox, listOutbox } from "@/frontend/lib/sync/outbox";
import type { NewOutboxEntry } from "@/frontend/lib/sync/types";

const ADDRESS = "0xAbCdEf0000000000000000000000000000000001";

function entry(overrides: Partial<NewOutboxEntry> = {}): NewOutboxEntry {
  return {
    address: ADDRESS,
    entity: "expense",
    op: "create",
    targetId: "target-1",
    request: { method: "POST", path: "/expenses", body: { note: "coffee" } },
    dependsOn: [],
    ...overrides,
  };
}

/** Install a fake apiFetch/ApiError pair and return control over the mock's outcomes. */
function mockApi() {
  class FakeApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  const calls: Array<{ path: string; method?: string }> = [];
  let outcomes: Array<() => Promise<unknown>> = [];

  mock.module("@/frontend/lib/api", () => ({
    ApiError: FakeApiError,
    apiFetch: async (path: string, opts: { method?: string } = {}) => {
      calls.push({ path, method: opts.method });
      const next = outcomes.shift();
      if (!next) return { ok: true };
      return next();
    },
  }));

  return {
    calls,
    ApiError: FakeApiError,
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

// Re-import engine.ts fresh each time isn't needed — bun's module cache is fine since
// mock.module is installed before engine.ts is ever imported below.
const { drainOutbox } = await import("@/frontend/lib/sync/engine");

beforeEach(() => {
  resetFakeIdb();
  api.reset();
  connectivity.setStatusForTests("online");
  // isOfflineFailure() falls back to `!navigator.onLine` — bun's bare `navigator`
  // has no `onLine` at all, which would misclassify every error as offline.
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
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
});
