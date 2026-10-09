import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { decryptJson, encryptJson } from "@/frontend/lib/crypto/e2ee";
import { rekeyLedgerToCustos } from "@/frontend/lib/crypto/rekey";
import { connectivity } from "@/frontend/lib/net/connectivity";
import { fakeLocalStorage } from "../helpers/fake-storage";

const oldFetch = globalThis.fetch;
const newKeyPair = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

beforeEach(() => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = fakeLocalStorage();
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => {
  globalThis.fetch = oldFetch;
  connectivity.setStatusForTests("online");
});

test("key migration rewrites Daily routines and completions under the new key, keeping routine and period", async () => {
  const oldKey = await newKeyPair();
  const newKey = await newKeyPair();
  const routinePayload = await encryptJson(oldKey, { title: "Stretch" });
  const completionPayload = await encryptJson(oldKey, { d: 1, at: "2026-10-09T08:00:00.000Z" });
  const writes: {
    method: string;
    path: string;
    body: { payload?: string } & Record<string, unknown>;
  }[] = [];

  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      writes.push({ method, path: url.pathname, body: JSON.parse(String(init?.body)) });
      return Response.json({ ok: true });
    }
    const lists: Record<string, unknown> = {
      "/api/wallets": { wallets: [] },
      "/api/categories": {},
      "/api/expenses": { expenses: [], hasMore: false },
      "/api/events": { events: [], hasMore: false },
      "/api/todo-lists": { todoLists: [] },
      "/api/capital-plans": { capitalPlans: [] },
      "/api/vehicles": { vehicles: [] },
      "/api/vehicles/fills": { fills: [], hasMore: false },
      "/api/daily/routines": { routines: [{ id: "r1", enc: 1, payload: routinePayload }] },
      "/api/daily/completions": {
        completions: [
          { id: "c1", routineId: "r1", period: "2026-10-09", enc: 1, payload: completionPayload },
        ],
      },
    };
    return Response.json(lists[url.pathname] ?? { error: `unexpected ${url.pathname}` });
  }) as typeof fetch;

  await rekeyLedgerToCustos(oldKey, newKey);

  const routine = writes.find((w) => w.path === "/api/daily/routines/r1")!;
  expect(routine.method).toBe("PATCH");
  expect(await decryptJson<{ title: string }>(newKey, routine.body.payload!)).toEqual({
    title: "Stretch",
  });

  const completion = writes.find((w) => w.path === "/api/daily/completions")!;
  expect(completion.method).toBe("PUT");
  expect(completion.body).toMatchObject({ routineId: "r1", period: "2026-10-09", enc: 1 });
  expect(await decryptJson<{ d: number; at: string }>(newKey, completion.body.payload!)).toEqual({
    d: 1,
    at: "2026-10-09T08:00:00.000Z",
  });
});
