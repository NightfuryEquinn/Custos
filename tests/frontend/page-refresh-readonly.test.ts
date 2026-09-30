import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLedger } from "@/frontend/lib/hooks/useLedger";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { api } from "@/frontend/lib/api";
import { connectivity } from "@/frontend/lib/net/connectivity";
import { getCipherCache } from "@/frontend/lib/pwa/cipher-cache";
import { fakeLocalStorage } from "../helpers/fake-storage";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const address = "0xabc0000000000000000000000000000000000001";
const oldFetch = globalThis.fetch;
let queryClient: QueryClient;

beforeEach(async () => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = fakeLocalStorage();
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
  ledgerKeyStore.set(
    address,
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
  );
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  globalThis.fetch = oldFetch;
  connectivity.setStatusForTests("online");
  ledgerKeyStore.clear(address);
  queryClient.clear();
});

test("manual overview refresh reads legacy data without seeding or migration writes", async () => {
  const calls: Array<{ path: string; method: string; cache?: RequestCache }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    calls.push({
      path: url.pathname + url.search,
      method: init?.method ?? "GET",
      cache: init?.cache,
    });
    const body =
      url.pathname === "/api/wallets"
        ? {
            wallets: [
              { id: "507f1f77bcf86cd799439011", name: "Legacy", currency: "MYR", isDefault: true },
            ],
          }
        : url.pathname === "/api/categories"
          ? { seed: true }
          : url.pathname === "/api/profile"
            ? { profile: { currentMonth: "2026-09" } }
            : url.pathname === "/api/expenses"
              ? { expenses: [], hasMore: false }
              : url.pathname === "/api/events"
                ? { events: [], hasMore: false }
                : url.pathname === "/api/todo-lists"
                  ? { todoLists: [] }
                  : url.pathname === "/api/capital-plans"
                    ? { capitalPlans: [] }
                    : { error: "unexpected request" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  let refresh!: ReturnType<typeof useLedger>["refreshPage"];
  function Probe() {
    refresh = useLedger(address).refreshPage;
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)));
  await refresh("overview");
  expect(calls).toHaveLength(7);
  expect(calls.every((call) => call.method === "GET" && call.cache === "no-store")).toBe(true);
  expect(calls.some((call) => call.path === "/api/wallets?readOnly=true")).toBe(true);
  expect(calls.some((call) => call.path === "/api/profile")).toBe(false);
});

test("a failed fresh read reports failure despite a warm offline cache", async () => {
  localStorage.setItem("ledger:session", address);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ seed: true }), { status: 200 })) as unknown as typeof fetch;
  await api.categories.list();
  expect(await getCipherCache<{ seed: boolean }>(address, "/categories")).toEqual({ seed: true });
  globalThis.fetch = (async () => {
    throw new TypeError("offline");
  }) as unknown as typeof fetch;
  await expect(api.categories.list({ fresh: true })).rejects.toThrow("offline");
});
