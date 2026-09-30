import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./net/api-error";
import type { ViewId } from "./types";

export type RefreshResource =
  | "wallets"
  | "categories"
  | "expenses"
  | "allExpenses"
  | "capitalPlans"
  | "events"
  | "todoLists"
  | "vehicles"
  | "vehicleFills"
  | "fx";

export const PAGE_REFRESH_RESOURCES: Record<ViewId, readonly RefreshResource[]> = {
  overview: [
    "wallets",
    "categories",
    "expenses",
    "allExpenses",
    "capitalPlans",
    "events",
    "todoLists",
  ],
  transactions: ["wallets", "categories", "expenses", "capitalPlans"],
  recurring: ["wallets", "categories", "expenses", "capitalPlans"],
  budgets: ["wallets", "categories", "expenses", "capitalPlans", "events"],
  calculator: ["wallets", "categories"],
  categories: ["categories", "expenses", "allExpenses"],
  schedule: ["wallets", "events"],
  todos: ["todoLists"],
  piggies: ["wallets", "categories", "allExpenses", "capitalPlans"],
  capitals: ["wallets", "categories", "allExpenses", "capitalPlans"],
  vehicles: ["wallets", "vehicles", "vehicleFills", "expenses", "allExpenses"],
  insights: ["wallets", "categories", "expenses", "capitalPlans", "fx"],
  transparency: [],
};

export type RefreshTask = { queryKey: readonly string[]; queryFn: () => Promise<unknown> };
type RefreshState = { pending?: Promise<void>; retryAt?: number; error?: ApiError };
const states = new WeakMap<QueryClient, Map<string, RefreshState>>();

/** Share concurrent refreshes without cancelling reads or executing mutations. */
export function refreshPageQueries(
  client: QueryClient,
  address: string,
  tasks: readonly RefreshTask[],
): Promise<void> {
  let accounts = states.get(client);
  if (!accounts) states.set(client, (accounts = new Map()));
  const account = address.toLowerCase();
  let state = accounts.get(account);
  if (!state) accounts.set(account, (state = {}));
  if (state.pending) return state.pending;
  if (state.retryAt && Date.now() < state.retryAt) return Promise.reject(state.error);
  state.retryAt = undefined;
  state.error = undefined;
  const current = state;
  const unique = new Map(tasks.map((task) => [JSON.stringify(task.queryKey), task]));
  current.pending = Promise.allSettled(
    [...unique.values()].map((task) => client.fetchQuery({ ...task, staleTime: 0, retry: false })),
  )
    .then((results) => {
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason as unknown] : [],
      );
      for (const error of errors) {
        if (error instanceof ApiError && error.status === 429) {
          current.retryAt = Math.max(
            current.retryAt ?? 0,
            Date.now() + (error.retryAfterMs ?? 30_000),
          );
          current.error = error;
        }
      }
      const authError = errors.find(
        (error) => error instanceof ApiError && (error.status === 401 || error.status === 403),
      );
      if (errors.length) throw authError ?? current.error ?? errors[0];
      current.error = undefined;
      current.retryAt = undefined;
    })
    .finally(() => {
      current.pending = undefined;
    });
  return current.pending;
}
