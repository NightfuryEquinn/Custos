import type { Account, FinancialWallet } from "./types";
import type {
  CapitalPlanWire,
  CategoriesWire,
  EventWire,
  ExpenseWire,
  TodoListWire,
  VehicleFillWire,
  VehicleWire,
  WalletWire,
} from "@/frontend/lib/crypto/codec";
import { getCipherCache, putCipherCache } from "@/frontend/lib/pwa/cipher-cache";
import { identityStorage } from "@/frontend/auth/lib/identity-storage";
import type { TourPreference } from "@/schemas/profile";

export class ApiError extends Error {
  status: number;
  retryAfterMs?: number;

  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

type ApiProfile = {
  id: string;
  currentMonth: string;
  /* Onboarding answer and the tours already shown. Server-side so the choice
     follows the user across devices instead of dying with localStorage. */
  tourPreference: TourPreference;
  toursSeen: string[];
  /* ISO timestamp of profile creation. */
  createdAt: string;
};

export type ApiSession = {
  id: string;
  device: string;
  ip?: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
};

type ApiUser = {
  id: string;
  address: string;
  codename: string;
  notifyEmail?: string;
  timezone?: string;
  emailRemindersEnabled?: boolean;
  budgetAlertsEnabled?: boolean;
};

type ApiConsent = {
  id: string;
  optedIn: boolean;
  updatedAt: string;
};

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

/** Paths safe to serve from the IndexedDB ciphertext read cache when offline. */
const CACHEABLE_GET_PREFIXES = [
  "/wallets",
  "/categories",
  "/expenses",
  "/events",
  "/todo-lists",
  "/profile",
  "/vehicles",
  "/users",
];

/** Whether a GET path may fall back to the local ciphertext cache. */
function isCacheableGet(path: string, method: string): boolean {
  if (method !== "GET") return false;
  return CACHEABLE_GET_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}?`) || path.startsWith(`${p}/`),
  );
}

/* A stuck request used to hang the UI on the loading spinner indefinitely —
   no timeout anywhere in this file. */
const REQUEST_TIMEOUT_MS = 20_000;

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, headers, signal, ...rest } = opts;
  const method = (rest.method ?? (body !== undefined ? "POST" : "GET")).toUpperCase();
  const address = identityStorage.session();

  try {
    const res = await fetch(`/api${path}`, {
      ...rest,
      method,
      credentials: "include",
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      const retryHeader = res.headers.get("Retry-After");
      const retryAfterMs = retryHeader ? Number(retryHeader) * 1000 : undefined;
      throw new ApiError(
        res.status,
        payload.error ?? res.statusText,
        Number.isFinite(retryAfterMs) && retryAfterMs! > 0 ? retryAfterMs : undefined,
      );
    }

    if (res.status === 204) return undefined as T;
    const json = (await res.json()) as T;
    if (address && isCacheableGet(path, method)) {
      void putCipherCache(address, path, json);
    }
    return json;
  } catch (err) {
    /* Serve a warm ciphertext copy for: real network failure, offline, a
       timed-out/aborted request, a rate limit, or a server error — none of
       those mean the data changed, so a stale read beats blanking the whole
       app. A 401/403/404 means the request itself is wrong and must not be
       papered over with cache. */
    const status = err instanceof ApiError ? err.status : undefined;
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    const cacheableFailure =
      err instanceof TypeError ||
      isAbort ||
      !navigator.onLine ||
      status === 429 ||
      (!!status && status >= 500);

    if (address && isCacheableGet(path, method) && cacheableFailure) {
      const cached = await getCipherCache<T>(address, path);
      if (cached != null) return cached;
    }
    throw err;
  }
}

export const api = {
  auth: {
    challenge(address: string) {
      return request<{ message: string; nonce: string; expiresAt: string; uri: string }>(
        "/auth/challenge",
        { method: "POST", body: { address } },
      );
    },
    verify(body: { address: string; message: string; signature: string }) {
      return request<{ account: Account; session: ApiSession }>("/auth/verify", {
        method: "POST",
        body,
      });
    },
    me() {
      return request<{ account: Account; session: ApiSession | null }>("/auth/me");
    },
    logout() {
      return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
    },
    sessions() {
      return request<{ sessions: ApiSession[] }>("/auth/sessions");
    },
    revokeSession(id: string) {
      return request<{ ok: boolean }>(`/auth/sessions/${id}`, { method: "DELETE" });
    },
    revokeOtherSessions() {
      return request<{ ok: boolean }>("/auth/sessions", { method: "DELETE" });
    },
    clearAll() {
      return request<{ ok: boolean; cleared: string[] }>("/auth/clear", { method: "POST" });
    },
  },

  users: {
    upsert(body: { address: string; codename: string }) {
      return request<{ user: ApiUser }>("/users", {
        method: "POST",
        body,
      });
    },
    me() {
      return request<{ user: ApiUser }>("/users/me");
    },
    updateMe(body: {
      codename?: string;
      notifyEmail?: string;
      timezone?: string;
      emailRemindersEnabled?: boolean;
      budgetAlertsEnabled?: boolean;
    }) {
      return request<{ user: ApiUser }>("/users/me", { method: "PATCH", body });
    },
  },

  push: {
    publicKey() {
      return request<{ key: string | null }>("/push/public-key");
    },
    subscribe(body: { endpoint: string; keys: { p256dh: string; auth: string } }) {
      return request<{ ok: boolean }>("/push/subscribe", { method: "POST", body });
    },
    unsubscribe(endpoint: string) {
      return request<{ ok: boolean; removed: number }>("/push/subscribe", {
        method: "DELETE",
        body: { endpoint },
      });
    },
  },

  consent: {
    get() {
      return request<{ consent: ApiConsent }>("/consent");
    },
    update(optedIn: boolean) {
      return request<{ consent: ApiConsent }>("/consent", {
        method: "PATCH",
        body: { optedIn },
      });
    },
  },

  profile: {
    get() {
      return request<{ profile: ApiProfile }>("/profile");
    },
    update(body: Partial<Pick<ApiProfile, "currentMonth" | "tourPreference" | "toursSeen">>) {
      return request<{ profile: ApiProfile }>("/profile", { method: "PATCH", body });
    },
  },

  wallets: {
    list() {
      return request<{ wallets: WalletWire[] }>("/wallets");
    },
    create(
      body:
        | { currency: string; fundingMode?: string; enc: 1; payload: string }
        | Record<string, unknown>,
    ) {
      return request<{ wallet: WalletWire }>("/wallets", { method: "POST", body });
    },
    update(
      id: string,
      body:
        | Partial<Pick<FinancialWallet, "currency" | "fundingMode" | "isDefault">>
        | Record<string, unknown>,
    ) {
      return request<{ wallet: WalletWire }>(`/wallets/${id}`, { method: "PATCH", body });
    },
    updateBudgets(id: string, body: { enc: 1; payload: string }) {
      return request<{ wallet: WalletWire }>(`/wallets/${id}/budgets`, {
        method: "PUT",
        body,
      });
    },
    remove(id: string) {
      return request<{ ok: boolean }>(`/wallets/${id}`, { method: "DELETE" });
    },
  },

  categories: {
    list() {
      return request<CategoriesWire>("/categories");
    },
    update(body: { enc: 1; payload: string }) {
      return request<{ enc: 1; payload: string }>("/categories", {
        method: "PUT",
        body,
      });
    },
  },

  expenses: {
    list(query?: {
      month?: string;
      from?: string;
      to?: string;
      limit?: number;
      before?: string;
      beforeId?: string;
      recurring?: boolean;
      walletId?: string;
      kind?: "expense" | "income";
    }) {
      const params = new URLSearchParams();
      if (query?.month) params.set("month", query.month);
      if (query?.from) params.set("from", query.from);
      if (query?.to) params.set("to", query.to);
      if (query?.limit != null) params.set("limit", String(query.limit));
      if (query?.before) params.set("before", query.before);
      if (query?.beforeId) params.set("beforeId", query.beforeId);
      if (query?.recurring !== undefined) params.set("recurring", String(query.recurring));
      if (query?.walletId) params.set("walletId", query.walletId);
      if (query?.kind) params.set("kind", query.kind);
      const qs = params.toString();
      return request<{
        expenses: ExpenseWire[];
        hasMore?: boolean;
        nextBefore?: string | null;
        nextBeforeId?: string | null;
      }>(`/expenses${qs ? `?${qs}` : ""}`);
    },
    create(body: Record<string, unknown>) {
      return request<{ expense: ExpenseWire }>("/expenses", { method: "POST", body });
    },
    update(id: string, body: Record<string, unknown>) {
      return request<{
        expense: ExpenseWire;
        deletedIds?: string[];
        endedIds?: string[];
      }>(`/expenses/${id}`, { method: "PATCH", body });
    },
    remove(id: string, opts?: { scope?: "this" | "future" | "all"; fromDate?: string }) {
      const params = new URLSearchParams();
      if (opts?.scope) params.set("scope", opts.scope);
      if (opts?.fromDate) params.set("fromDate", opts.fromDate);
      const qs = params.toString();
      return request<{ ok: boolean; deletedIds?: string[]; skippedId?: string }>(
        `/expenses/${id}${qs ? `?${qs}` : ""}`,
        { method: "DELETE" },
      );
    },
  },

  events: {
    list(query?: {
      month?: string;
      from?: string;
      to?: string;
      limit?: number;
      before?: string;
      beforeId?: string;
    }) {
      const params = new URLSearchParams();
      if (query?.month) params.set("month", query.month);
      if (query?.from) params.set("from", query.from);
      if (query?.to) params.set("to", query.to);
      if (query?.limit != null) params.set("limit", String(query.limit));
      if (query?.before) params.set("before", query.before);
      if (query?.beforeId) params.set("beforeId", query.beforeId);
      const qs = params.toString();
      return request<{
        events: EventWire[];
        hasMore?: boolean;
        nextBefore?: string | null;
        nextBeforeId?: string | null;
      }>(`/events${qs ? `?${qs}` : ""}`);
    },
    create(body: Record<string, unknown>) {
      return request<{ event: EventWire }>("/events", { method: "POST", body });
    },
    update(id: string, body: Record<string, unknown>) {
      return request<{ event: EventWire }>(`/events/${id}`, { method: "PATCH", body });
    },
    remove(id: string, opts?: { scope?: "this" | "future" | "all"; fromDate?: string }) {
      const params = new URLSearchParams();
      if (opts?.scope) params.set("scope", opts.scope);
      if (opts?.fromDate) params.set("fromDate", opts.fromDate);
      const qs = params.toString();
      return request<{ ok: boolean; deleted?: boolean; event?: EventWire }>(
        `/events/${id}${qs ? `?${qs}` : ""}`,
        { method: "DELETE" },
      );
    },
  },

  todoLists: {
    list() {
      return request<{ todoLists: TodoListWire[] }>("/todo-lists");
    },
    create(body: { enc: 1; payload: string }) {
      return request<{ todoList: TodoListWire }>("/todo-lists", { method: "POST", body });
    },
    update(id: string, body: { enc: 1; payload: string }) {
      return request<{ todoList: TodoListWire }>(`/todo-lists/${id}`, { method: "PATCH", body });
    },
    remove(id: string) {
      return request<{ ok: boolean }>(`/todo-lists/${id}`, { method: "DELETE" });
    },
  },

  capitalPlans: {
    list() {
      return request<{ capitalPlans: CapitalPlanWire[] }>("/capital-plans");
    },
    create(body: { enc: 1; payload: string }) {
      return request<{ capitalPlan: CapitalPlanWire }>("/capital-plans", { method: "POST", body });
    },
    update(id: string, body: { enc: 1; payload: string }) {
      return request<{ capitalPlan: CapitalPlanWire }>(`/capital-plans/${id}`, {
        method: "PATCH",
        body,
      });
    },
    remove(id: string) {
      return request<{ ok: boolean }>(`/capital-plans/${id}`, { method: "DELETE" });
    },
  },

  vehicles: {
    list() {
      return request<{ vehicles: VehicleWire[] }>("/vehicles");
    },
    create(body: { type: string; enc: 1; payload: string }) {
      return request<{ vehicle: VehicleWire }>("/vehicles", { method: "POST", body });
    },
    update(id: string, body: { type?: string; enc: 1; payload: string }) {
      return request<{ vehicle: VehicleWire }>(`/vehicles/${id}`, { method: "PATCH", body });
    },
    remove(id: string) {
      return request<{ ok: boolean }>(`/vehicles/${id}`, { method: "DELETE" });
    },
    fills: {
      list(
        params: { vehicleId?: string; limit?: number; before?: string; beforeId?: string } = {},
      ) {
        const qs = new URLSearchParams();
        if (params.vehicleId) qs.set("vehicleId", params.vehicleId);
        if (params.limit) qs.set("limit", String(params.limit));
        if (params.before) qs.set("before", params.before);
        if (params.beforeId) qs.set("beforeId", params.beforeId);
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        return request<{
          fills: VehicleFillWire[];
          hasMore: boolean;
          nextBefore: string | null;
          nextBeforeId: string | null;
        }>(`/vehicles/fills${suffix}`);
      },
      create(body: {
        vehicleId: string;
        date: string;
        partial: boolean;
        expenseId?: string;
        enc: 1;
        payload: string;
      }) {
        return request<{ fill: VehicleFillWire }>("/vehicles/fills", { method: "POST", body });
      },
      update(
        id: string,
        body: {
          vehicleId?: string;
          date?: string;
          partial?: boolean;
          expenseId?: string | null;
          enc: 1;
          payload: string;
        },
      ) {
        return request<{ fill: VehicleFillWire }>(`/vehicles/fills/${id}`, {
          method: "PATCH",
          body,
        });
      },
      remove(id: string) {
        return request<{ ok: boolean }>(`/vehicles/fills/${id}`, { method: "DELETE" });
      },
    },
  },

  fx: {
    latest(base: string) {
      return request<{
        base: string;
        rates: Record<string, number>;
        fetchedAt: number;
        cached: boolean;
      }>(`/fx/latest/${encodeURIComponent(base)}`);
    },
  },

  budgetAlerts: {
    notify(body: {
      walletId: string;
      walletName?: string;
      month: string;
      alerts: Array<{
        categoryId: string;
        categoryName: string;
        spent: number;
        budget: number;
        level: "warning" | "exceeded";
        currency?: string;
      }>;
    }) {
      return request<{ ok: boolean; sent: number; skipped: number; errors: string[] }>(
        "/budget-alerts",
        { method: "POST", body },
      );
    },
  },
};
