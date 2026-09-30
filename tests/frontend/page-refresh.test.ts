import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/frontend/lib/net/api-error";
import { PAGE_REFRESH_RESOURCES, refreshPageQueries } from "@/frontend/lib/page-refresh";

const address = "0xabc";
const clients: QueryClient[] = [];
function client() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(queryClient);
  return queryClient;
}
afterEach(() => {
  for (const queryClient of clients.splice(0)) queryClient.clear();
});

describe("page refresh", () => {
  test("refreshes only selected page dependencies", () => {
    expect(PAGE_REFRESH_RESOURCES.calculator).toEqual(["wallets", "categories"]);
    expect(PAGE_REFRESH_RESOURCES.schedule).toEqual(["wallets", "events"]);
    expect(PAGE_REFRESH_RESOURCES.vehicles).toContain("allExpenses");
    expect(PAGE_REFRESH_RESOURCES.vehicles).toContain("expenses");
    expect(PAGE_REFRESH_RESOURCES.budgets).toContain("events");
    expect(PAGE_REFRESH_RESOURCES.transparency).toEqual([]);
    expect(Object.values(PAGE_REFRESH_RESOURCES)).toHaveLength(13);
  });

  test("rapid clicks share the same operation and keep old content until it resolves", async () => {
    const queryClient = client();
    const key = ["wallets", address];
    queryClient.setQueryData(key, ["old"]);
    let finish!: (value: string[]) => void;
    let calls = 0;
    const task = {
      queryKey: key,
      queryFn: () => {
        calls++;
        return new Promise<string[]>((resolve) => {
          finish = resolve;
        });
      },
    };
    const first = refreshPageQueries(queryClient, address, [task, task]);
    const second = refreshPageQueries(queryClient, address.toUpperCase(), [task]);
    expect(first).toBe(second);
    expect(calls).toBe(1);
    expect(queryClient.getQueryData<string[]>(key)).toEqual(["old"]);
    finish(["new"]);
    await first;
    expect(queryClient.getQueryData<string[]>(key)).toEqual(["new"]);
  });

  test("joins an existing query fetch rather than starting a second request", async () => {
    const queryClient = client();
    const key = ["events", address, "2026-09"];
    let finish!: (value: number) => void;
    const initial = queryClient.fetchQuery({
      queryKey: key,
      queryFn: () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    });
    let extraCalls = 0;
    const refresh = refreshPageQueries(queryClient, address, [
      {
        queryKey: key,
        queryFn: async () => {
          extraCalls++;
          return 2;
        },
      },
    ]);
    finish(1);
    await Promise.all([initial, refresh]);
    expect(extraCalls).toBe(0);
    expect(queryClient.getQueryData<number>(key)).toBe(1);
  });

  test("a failed read leaves the cached answer and a later click can retry", async () => {
    const queryClient = client();
    const key = ["expenses", address];
    queryClient.setQueryData(key, ["saved"]);
    await expect(
      refreshPageQueries(queryClient, address, [
        {
          queryKey: key,
          queryFn: async () => {
            throw new Error("offline");
          },
        },
      ]),
    ).rejects.toThrow("offline");
    expect(queryClient.getQueryData<string[]>(key)).toEqual(["saved"]);
    await refreshPageQueries(queryClient, address, [
      { queryKey: key, queryFn: async () => ["updated"] },
    ]);
    expect(queryClient.getQueryData<string[]>(key)).toEqual(["updated"]);
  });

  test("429 blocks immediate repeats for the server retry interval", async () => {
    const queryClient = client();
    let calls = 0;
    const task = {
      queryKey: ["fx", "MYR"],
      queryFn: async () => {
        calls++;
        throw new ApiError(429, "slow down", 60_000);
      },
    };
    await expect(refreshPageQueries(queryClient, address, [task])).rejects.toMatchObject({
      status: 429,
    });
    await expect(refreshPageQueries(queryClient, address, [task])).rejects.toMatchObject({
      status: 429,
    });
    expect(calls).toBe(1);
  });
});
