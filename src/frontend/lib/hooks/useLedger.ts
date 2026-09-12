import { api } from "@/frontend/lib/api";
import { maybeNotifyBudgetAlerts } from "@/frontend/lib/budget/notify";
import {
  buildReminderDetails,
  decodeCapitalPlan,
  decodeCategories,
  decodeEvent,
  decodeExpense,
  decodeTodoList,
  decodeVehicle,
  decodeVehicleFill,
  decodeWallet,
  encodeCapitalPlanCreate,
  encodeCapitalPlanUpdate,
  encodeCategories,
  encodeEventCreate,
  encodeEventUpdate,
  encodeExpenseCreate,
  encodeExpenseUpdate,
  encodeTodoListCreate,
  encodeTodoListUpdate,
  encodeVehicleCreate,
  encodeVehicleFillCreate,
  encodeVehicleFillUpdate,
  encodeVehicleUpdate,
  encodeWalletFinancials,
  type EventWire,
  type ReminderContext,
} from "@/frontend/lib/crypto/codec";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { releaseOrphanedPlanRefs } from "@/frontend/lib/capitals";
import { mergeCategoryBudget } from "@/frontend/lib/category-retire";
import {
  applyTransferFields,
  expensesMatchingSubs,
  runPacedTransfer,
} from "@/frontend/lib/category-transfer";
import { buildCategoryIndex, isIncomeCategory, type CategoryType } from "@/frontend/lib/categories";
import { CURRENT_MONTH_KEY, clampMonthKey } from "@/frontend/lib/data";
import {
  classifyTx,
  normalizeRecurring,
  recurringScheduleKey,
  sortExpensesByDateDesc,
} from "@/frontend/lib/stats";
import type {
  Budgets,
  CapitalPlan,
  Category,
  Expense,
  FinancialWallet,
  FuelFill,
  LedgerEvent,
  TodoList,
  Vehicle,
} from "@/frontend/lib/types";
import type { DeleteScope } from "@/lib/delete-scope";
import { DEFAULT_CATEGORIES, validateTaxonomy } from "@/schemas/category";
import type { TourPreference } from "@/schemas/profile";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

const ACTIVE_WALLET_KEY = "ledger:active-wallet";

type DeleteScopeOpts = { scope?: DeleteScope; fromDate?: string };

/** Storage key for the last active wallet per account. */
function activeWalletStorageKey(wallet: string) {
  return `${ACTIVE_WALLET_KEY}:${wallet.toLowerCase()}`;
}

/** Require an unlocked ledger crypto key for the given address. */
function requireKey(address: string): CryptoKey {
  const key = ledgerKeyStore.get(address);
  if (!key) throw new Error("Encryption key is locked");
  return key;
}

/** Client-side check that custom events include label + glyph before encrypt. */
function assertCustomEventFields(data: Pick<LedgerEvent, "catId" | "customLabel" | "customGlyph">) {
  if (data.catId !== "custom") return;
  if (!data.customLabel?.trim()) throw new Error("Custom type name is required");
  if (!data.customGlyph?.trim()) throw new Error("Custom emoji is required");
}

/** Clone default category taxonomy for first-time seed. */
function cloneDefaultCategories(): Category[] {
  return DEFAULT_CATEGORIES.map((c) => ({
    ...c,
    subs: c.subs.map((s) => ({ ...s })),
  }));
}

/** Shift a YYYY-MM key by a signed month delta. */
function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** ISO date at the start of a month key. */
function monthStartIso(key: string): string {
  return `${key}-01`;
}

const EXPENSE_LOOKBACK_MONTHS = 36;
const LIST_PAGE_LIMIT = 2000;

/*
 * Reminder events saved before `notifyDetails` existed would email a
 * content-free body. Attaching the copy is a one-off write per event, so it is
 * capped and batched: a month full of reminders must not burst hundreds of
 * PATCHes into the shared rate limit on first load. Whatever is left over is
 * picked up by later loads.
 */
const REMINDER_BACKFILL_PER_LOAD = 10;
const REMINDER_BACKFILL_CONCURRENCY = 5;

/**
 * Attach the reminder email copy to already-encrypted events that lack it.
 * Best-effort by design — it changes nothing the client renders, so a failed
 * write is swallowed rather than failing the whole events query. Legacy
 * plaintext rows (`enc` unset) are skipped: their own migration re-encrypts the
 * payload, and reusing the stale ciphertext here would undo that.
 */
async function backfillReminderDetails(
  pairs: Array<{ wire: EventWire; event: LedgerEvent }>,
  currency: string | undefined,
  catById: Record<string, Category>,
): Promise<void> {
  const stale = pairs
    .filter(
      ({ wire, event }) => wire.enc === 1 && wire.payload && !wire.notifyDetails && event.notify,
    )
    .slice(0, REMINDER_BACKFILL_PER_LOAD);

  for (let i = 0; i < stale.length; i += REMINDER_BACKFILL_CONCURRENCY) {
    await Promise.all(
      stale.slice(i, i + REMINDER_BACKFILL_CONCURRENCY).map(async ({ wire, event }) => {
        const notifyDetails = buildReminderDetails(event, {
          currency,
          holdCategoryName: event.budgetHoldCategoryId
            ? catById[event.budgetHoldCategoryId]?.name
            : undefined,
        });
        if (!notifyDetails) return;

        try {
          /* No `notify` in the body — the server only re-confirms when a request turns it on. */
          await api.events.update(wire.id, { enc: 1, payload: wire.payload, notifyDetails });
        } catch {
          /* A later load retries; reminders still send, just without the details. */
        }
      }),
    );
  }
}

const keys = {
  profile: (wallet: string) => ["profile", wallet] as const,
  wallets: (wallet: string) => ["wallets", wallet] as const,
  categories: (wallet: string) => ["categories", wallet] as const,
  expenses: (wallet: string) => ["expenses", wallet] as const,
  allExpenses: (wallet: string) => ["all-expenses", wallet] as const,
  events: (wallet: string, month: string) => ["events", wallet, month] as const,
  todoLists: (wallet: string) => ["todoLists", wallet] as const,
  capitalPlans: (wallet: string) => ["capitalPlans", wallet] as const,
  vehicles: (wallet: string) => ["vehicles", wallet] as const,
  vehicleFills: (wallet: string) => ["vehicleFills", wallet] as const,
};

/* Stable empty list so an unloaded profile does not hand consumers a fresh
   array on every render and retrigger their effects. */
const EMPTY_TOURS_SEEN: string[] = [];

export function useLedger(walletAddress: string) {
  const queryClient = useQueryClient();
  const wallet = walletAddress.toLowerCase();
  const cryptoReady = ledgerKeyStore.isUnlocked(wallet);

  const [activeWalletId, setActiveWalletIdState] = useState<string | null>(() => {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(activeWalletStorageKey(wallet));
  });

  const profileQuery = useQuery({
    queryKey: keys.profile(wallet),
    queryFn: async () => {
      const { profile } = await api.profile.get();
      return profile;
    },
    enabled: cryptoReady,
  });

  const walletsQuery = useQuery({
    queryKey: keys.wallets(wallet),
    queryFn: async () => {
      const { wallets } = await api.wallets.list();
      const cryptoKey = requireKey(wallet);
      return Promise.all(
        wallets.map(async (wire) => {
          const decoded = await decodeWallet(wire, cryptoKey);
          /* Migrate legacy plaintext name/financials into the E2EE payload.
             Fire-and-forget: `decoded` already holds the values being sent,
             so this load doesn't need the round trip's echo back — a first
             load shouldn't block on a one-time migration write. */
          if (!wire.enc || wire.name != null) {
            void encodeWalletFinancials(
              {
                name: decoded.name,
                income: decoded.income,
                startingBalance: decoded.startingBalance,
                budgets: decoded.budgets,
              },
              cryptoKey,
            )
              .then((encrypted) => api.wallets.update(wire.id, encrypted))
              .catch(() => {
                /* A later load retries the migration. */
              });
          }
          return decoded;
        }),
      );
    },
    enabled: cryptoReady,
  });

  const categoriesQuery = useQuery({
    queryKey: keys.categories(wallet),
    queryFn: async () => {
      const wire = await api.categories.list();
      const cryptoKey = requireKey(wallet);

      /* Both branches below persist the returned value in the background —
         it's already what's being returned to the query, so this load
         doesn't need to wait for the write to land. */
      if (wire.seed) {
        const defaults = cloneDefaultCategories();
        void encodeCategories(defaults, cryptoKey)
          .then((encrypted) => api.categories.update(encrypted))
          .catch(() => {
            /* A later load retries seeding. */
          });
        return defaults;
      }

      if (!wire.enc && wire.categories) {
        void encodeCategories(wire.categories, cryptoKey)
          .then((encrypted) => api.categories.update(encrypted))
          .catch(() => {
            /* A later load retries the migration. */
          });
        return wire.categories;
      }

      return decodeCategories(wire, cryptoKey);
    },
    enabled: cryptoReady,
  });

  const categoryIndex = useMemo(
    () => buildCategoryIndex(categoriesQuery.data ?? []),
    [categoriesQuery.data],
  );

  const month = clampMonthKey(profileQuery.data?.currentMonth ?? CURRENT_MONTH_KEY);

  const wallets = (walletsQuery.data ?? []).map((w) => ({
    ...w,
    fundingMode: w.fundingMode ?? "monthly",
    startingBalance: w.startingBalance ?? 0,
  }));

  const activeWallet = useMemo(() => {
    if (!wallets.length) return null;
    if (activeWalletId) {
      const found = wallets.find((w) => w.id === activeWalletId);
      if (found) return found;
    }
    return wallets.find((w) => w.isDefault) ?? wallets[0];
  }, [wallets, activeWalletId]);

  useEffect(() => {
    if (!activeWallet) return;
    if (activeWalletId !== activeWallet.id) {
      setActiveWalletIdState(activeWallet.id);
      localStorage.setItem(activeWalletStorageKey(wallet), activeWallet.id);
    }
  }, [activeWallet, activeWalletId, wallet]);

  const setActiveWalletId = useCallback(
    (id: string) => {
      setActiveWalletIdState(id);
      localStorage.setItem(activeWalletStorageKey(wallet), id);
    },
    [wallet],
  );

  const capitalPlansQuery = useQuery({
    queryKey: keys.capitalPlans(wallet),
    queryFn: async () => {
      const { capitalPlans } = await api.capitalPlans.list();
      const cryptoKey = requireKey(wallet);
      return Promise.all(capitalPlans.map((wire) => decodeCapitalPlan(wire, cryptoKey)));
    },
    /* No dependency on profile — `month` (the only profile field this hook
       reads) already has a default, so gating on it was a pure waterfall. */
    enabled: cryptoReady,
  });

  /*
   * Declared before the expense queries because both heal orphaned plan refs
   * below, and a useMemo body runs during this render — reading a `const`
   * declared further down would hit the temporal dead zone.
   *
   * Null until the plans have actually loaded: treating every assignment as
   * orphaned mid-load would flash wrong balances and, worse, let an unrelated
   * edit save the cleared assignment back.
   */
  const livePlans = useMemo(
    () => (capitalPlansQuery.isSuccess ? (capitalPlansQuery.data ?? []) : null),
    [capitalPlansQuery.isSuccess, capitalPlansQuery.data],
  );

  const expensesQuery = useQuery({
    queryKey: keys.expenses(wallet),
    queryFn: async () => {
      const from = monthStartIso(shiftMonthKey(CURRENT_MONTH_KEY, -EXPENSE_LOOKBACK_MONTHS));
      const cryptoKey = requireKey(wallet);
      const collected: Awaited<ReturnType<typeof decodeExpense>>[] = [];
      let before: string | undefined;
      let beforeId: string | undefined;

      for (;;) {
        const page = await api.expenses.list({
          from,
          limit: LIST_PAGE_LIMIT,
          before,
          beforeId,
        });
        const decoded = await Promise.all(page.expenses.map((e) => decodeExpense(e, cryptoKey)));
        collected.push(...decoded);
        if (!page.hasMore || !page.nextBefore) break;
        before = page.nextBefore;
        beforeId = page.nextBeforeId ?? undefined;
        /* Cap: LIST_PAGE_LIMIT * 5 = 10,000 rows across all wallets (~36-month window). */
        if (collected.length >= LIST_PAGE_LIMIT * 5) break;
      }

      return collected;
    },
    /* queryFn only needs requireKey(wallet) (cryptoReady) — it fetches by
       date range with no wallet or category filter (that filtering happens
       client-side below), so profile/wallets/categories were pure waterfall. */
    enabled: cryptoReady,
  });

  /* Was a bare .map() in the render body — re-running over up to 10,000 rows
     on every LedgerApp render (any modal open, any FAB toggle), not just
     when the underlying data actually changed. */
  const decodedExpenses = useMemo(
    () =>
      (expensesQuery.data ?? []).map((e) => ({
        ...e,
        kind: e.kind ?? "expense",
        recurring: normalizeRecurring(e.recurring),
      })),
    [expensesQuery.data],
  );
  /* Null plans means "not loaded", not "no plans exist" — healing against an
     empty roster would strip every live assignment. */
  const allExpenses = useMemo(
    () => (livePlans ? releaseOrphanedPlanRefs(decodedExpenses, livePlans) : decodedExpenses),
    [decodedExpenses, livePlans],
  );
  const expenses = useMemo(
    () => (activeWallet ? allExpenses.filter((e) => e.walletId === activeWallet.id) : []),
    [allExpenses, activeWallet],
  );

  /*
   * Full account expense history (no `from` / wallet filter on the API). Used for
   * piggy balances, usedSubIds, and starting-mode wallet balance. Cap:
   * LIST_PAGE_LIMIT * 20 = 40,000 rows.
   */
  const allExpensesQuery = useQuery({
    queryKey: keys.allExpenses(wallet),
    queryFn: async () => {
      const cryptoKey = requireKey(wallet);
      const collected: Awaited<ReturnType<typeof decodeExpense>>[] = [];
      let before: string | undefined;
      let beforeId: string | undefined;

      for (;;) {
        const page = await api.expenses.list({ limit: LIST_PAGE_LIMIT, before, beforeId });
        const decoded = await Promise.all(page.expenses.map((e) => decodeExpense(e, cryptoKey)));
        collected.push(...decoded);
        if (!page.hasMore || !page.nextBefore) break;
        before = page.nextBefore;
        beforeId = page.nextBeforeId ?? undefined;
        /* Cap: LIST_PAGE_LIMIT * 20 = 40,000 rows of full history. */
        if (collected.length >= LIST_PAGE_LIMIT * 20) break;
      }

      return collected;
    },
    /* No wallet/category filter on this fetch either — see expensesQuery. */
    enabled: cryptoReady,
    staleTime: 5 * 60 * 1000,
  });

  /* Decode + heal once, shared by savingsTxns and balanceExpenses below —
     these used to each redo the same map + releaseOrphanedPlanRefs pass over
     up to 40,000 rows independently. */
  const allExpensesHealed = useMemo(() => {
    const decoded = (allExpensesQuery.data ?? []).map((e) => ({
      ...e,
      kind: e.kind ?? "expense",
      recurring: normalizeRecurring(e.recurring),
    }));
    return livePlans ? releaseOrphanedPlanRefs(decoded, livePlans) : decoded;
  }, [allExpensesQuery.data, livePlans]);

  const savingsTxns = useMemo(
    () =>
      allExpensesHealed.filter((e) => {
        if (activeWallet && e.walletId !== activeWallet.id) return false;
        const cls = classifyTx(e, categoryIndex);
        return cls === "savings" || cls === "withdrawal";
      }),
    [allExpensesHealed, categoryIndex, activeWallet],
  );

  const balanceExpenses = useMemo(
    () => (activeWallet ? allExpensesHealed.filter((e) => e.walletId === activeWallet.id) : []),
    [allExpensesHealed, activeWallet],
  );

  /**
   * Subcategories with transaction history, across full history and every
   * wallet. A category holding any of these is archived rather than deleted, so
   * its past transactions keep resolving to the right type.
   *
   * `allExpensesQuery` fetches with no `from` and no `walletId`, so its rows are
   * every expense on the account — which is the point. Deriving this from the
   * windowed, wallet-scoped `expenses` let a category whose deposits sat in
   * another wallet or predated the lookback be hard-deleted, silently
   * reclassifying that history as spending and dropping its balance out of
   * Piggies entirely.
   *
   * Null while the unbounded query is still in flight: retire helpers refuse
   * rather than hard-deleting (or archiving) on a partial answer.
   */
  const usedSubIds = useMemo(() => {
    if (!allExpensesQuery.isSuccess) return null;
    const subs = new Set((allExpensesQuery.data ?? []).map((e) => e.sub));
    for (const e of expensesQuery.data ?? []) subs.add(e.sub);

    return subs;
  }, [allExpensesQuery.isSuccess, allExpensesQuery.data, expensesQuery.data]);

  const eventsQuery = useQuery({
    queryKey: keys.events(wallet, month),
    queryFn: async () => {
      /*
       * Load by viewed month so once-events on future days (and recurring
       * series that still occur this month) are included for holds/agenda.
       */
      const cryptoKey = requireKey(wallet);
      const collected: Awaited<ReturnType<typeof decodeEvent>>[] = [];
      let before: string | undefined;
      let beforeId: string | undefined;

      for (;;) {
        const page = await api.events.list({ month, limit: LIST_PAGE_LIMIT, before, beforeId });
        const decoded = await Promise.all(
          page.events.map(async (wire) => {
            if (!wire.enc && wire.title) {
              const body = await encodeEventUpdate(
                {
                  title: wire.title,
                  comments: wire.comments ?? [],
                  customLabel: wire.customLabel,
                  customGlyph: wire.customGlyph,
                  catId: wire.catId,
                  date: wire.date,
                  endDate: wire.endDate ?? null,
                  allDay: wire.allDay,
                  time: wire.time,
                  endTime: wire.endTime ?? null,
                  repeat: wire.repeat,
                  exceptDates: wire.exceptDates,
                  until: wire.until,
                  notify: wire.notify,
                  lead: wire.lead,
                  email: wire.email ?? "",
                },
                cryptoKey,
              );
              const { event } = await api.events.update(wire.id, body);
              return decodeEvent(event, cryptoKey);
            }

            return decodeEvent(wire, cryptoKey);
          }),
        );

        /* Fire-and-forget: notifyDetails only affects a future reminder send,
           not anything this load renders, so it shouldn't hold up the query. */
        void backfillReminderDetails(
          page.events.map((wire, i) => ({ wire, event: decoded[i]! })),
          activeWallet?.currency,
          categoryIndex.catById,
        );

        collected.push(...decoded);
        if (!page.hasMore || !page.nextBefore) break;
        before = page.nextBefore;
        beforeId = page.nextBeforeId ?? undefined;
        if (collected.length >= LIST_PAGE_LIMIT * 5) break;
      }

      return collected;
    },
    enabled: cryptoReady && !!profileQuery.data,
    /*
     * The key is month-scoped, so switching months would otherwise put this
     * query back into `pending` and trip the app-wide "Loading your ledger…"
     * screen. Holding the previous month's rows keeps the shell mounted while
     * the new month streams in.
     */
    placeholderData: keepPreviousData,
  });

  const todoListsQuery = useQuery({
    queryKey: keys.todoLists(wallet),
    queryFn: async () => {
      const { todoLists } = await api.todoLists.list();
      const cryptoKey = requireKey(wallet);
      return Promise.all(
        todoLists.map(async (wire) => {
          if (!wire.enc && wire.name) {
            /* Fire-and-forget: decoding `wire` directly already gives the
               same result the round trip's echo would, so this load
               doesn't need to wait for the migration write to land. */
            void encodeTodoListUpdate(
              { name: wire.name, icon: wire.icon ?? "📋", tasks: wire.tasks ?? [] },
              cryptoKey,
            )
              .then((encrypted) => api.todoLists.update(wire.id, encrypted))
              .catch(() => {
                /* A later load retries the migration. */
              });
          }
          return decodeTodoList(wire, cryptoKey);
        }),
      );
    },
    /* No dependency on profile — see capitalPlansQuery. */
    enabled: cryptoReady,
  });

  const vehiclesQuery = useQuery({
    queryKey: keys.vehicles(wallet),
    queryFn: async () => {
      const { vehicles } = await api.vehicles.list();
      const cryptoKey = requireKey(wallet);
      return Promise.all(vehicles.map((wire) => decodeVehicle(wire, cryptoKey)));
    },
    /* No dependency on profile — see capitalPlansQuery. */
    enabled: cryptoReady,
  });

  /*
   * Vehicles are account-scoped, not wallet-scoped, and fuel history is small
   * relative to transaction volume — an unbounded fetch stays cheap in practice,
   * same reasoning as the allExpensesQuery above.
   */
  const vehicleFillsQuery = useQuery({
    queryKey: keys.vehicleFills(wallet),
    queryFn: async () => {
      const cryptoKey = requireKey(wallet);
      const collected: Awaited<ReturnType<typeof decodeVehicleFill>>[] = [];
      let before: string | undefined;
      let beforeId: string | undefined;

      for (;;) {
        const page = await api.vehicles.fills.list({ limit: LIST_PAGE_LIMIT, before, beforeId });
        const decoded = await Promise.all(page.fills.map((f) => decodeVehicleFill(f, cryptoKey)));
        collected.push(...decoded);
        if (!page.hasMore || !page.nextBefore) break;
        before = page.nextBefore;
        beforeId = page.nextBeforeId ?? undefined;
        if (collected.length >= LIST_PAGE_LIMIT * 5) break;
      }

      return collected;
    },
    /* No dependency on profile — see capitalPlansQuery. */
    enabled: cryptoReady,
  });

  const setMonthMutation = useMutation({
    mutationFn: (currentMonth: string) => api.profile.update({ currentMonth }),
    onSuccess: ({ profile }) => {
      queryClient.setQueryData(keys.profile(wallet), profile);
    },
  });

  /* Onboarding answer and tour-seen list, persisted on the profile so the
     choice follows the user rather than the browser. */
  const setTourStateMutation = useMutation({
    mutationFn: (state: { tourPreference?: TourPreference; toursSeen?: string[] }) =>
      api.profile.update(state),
    onSuccess: ({ profile }) => {
      queryClient.setQueryData(keys.profile(wallet), profile);
    },
  });

  const setBudgetsMutation = useMutation({
    mutationFn: async (budgets: Budgets) => {
      if (!activeWallet) throw new Error("No active wallet");
      const cryptoKey = requireKey(wallet);
      const encrypted = await encodeWalletFinancials(
        {
          name: activeWallet.name,
          income: activeWallet.income,
          startingBalance: activeWallet.startingBalance,
          budgets,
        },
        cryptoKey,
      );
      return api.wallets.updateBudgets(activeWallet.id, encrypted);
    },
    onSuccess: async ({ wallet: wire }) => {
      const cryptoKey = requireKey(wallet);
      const updated = await decodeWallet(wire, cryptoKey);
      queryClient.setQueryData<FinancialWallet[]>(keys.wallets(wallet), (prev = []) =>
        prev.map((w) => (w.id === updated.id ? updated : w)),
      );
    },
  });

  const saveWalletMutation = useMutation({
    mutationFn: async (
      data: Partial<FinancialWallet> & { id?: string; name?: string; currency?: string },
    ) => {
      const cryptoKey = requireKey(wallet);
      if (data.id) {
        const existing = (walletsQuery.data ?? []).find((w) => w.id === data.id);
        const name = data.name ?? existing?.name ?? "Wallet";
        const financialPatch =
          data.name !== undefined ||
          data.income !== undefined ||
          data.startingBalance !== undefined ||
          data.budgets !== undefined
            ? await encodeWalletFinancials(
                {
                  name,
                  income: data.income ?? existing?.income ?? 0,
                  startingBalance: data.startingBalance ?? existing?.startingBalance ?? 0,
                  budgets: data.budgets ?? existing?.budgets ?? {},
                },
                cryptoKey,
              )
            : {};
        const { wallet: updated } = await api.wallets.update(data.id, {
          currency: data.currency,
          fundingMode: data.fundingMode,
          isDefault: data.isDefault,
          ...financialPatch,
        });
        return decodeWallet(updated, cryptoKey);
      }
      const encrypted = await encodeWalletFinancials(
        {
          name: data.name!,
          income: data.fundingMode === "monthly" ? (data.income ?? 0) : 0,
          startingBalance: data.fundingMode === "starting" ? (data.startingBalance ?? 0) : 0,
          budgets: {},
        },
        cryptoKey,
      );
      const { wallet: created } = await api.wallets.create({
        currency: data.currency!,
        fundingMode: data.fundingMode,
        ...encrypted,
      });
      return decodeWallet(created, cryptoKey);
    },
    onSuccess: (saved, variables) => {
      queryClient.setQueryData<FinancialWallet[]>(keys.wallets(wallet), (prev = []) => {
        if (variables.id) {
          return prev.map((w) =>
            w.id === saved.id
              ? saved
              : w.isDefault && saved.isDefault
                ? { ...w, isDefault: false }
                : w,
          );
        }
        return [...prev, saved];
      });
      if (!variables.id) setActiveWalletId(saved.id);
    },
  });

  const deleteWalletMutation = useMutation({
    mutationFn: (id: string) => api.wallets.remove(id),
    onSuccess: (_res, id) => {
      queryClient.setQueryData<FinancialWallet[]>(keys.wallets(wallet), (prev = []) => {
        const next = prev.filter((w) => w.id !== id);
        if (activeWalletId === id && next.length) {
          const fallback = next.find((w) => w.isDefault) ?? next[0];
          if (fallback) setActiveWalletId(fallback.id);
        }
        return next;
      });
    },
  });

  const saveExpenseMutation = useMutation({
    mutationFn: async (data: Omit<Expense, "id"> & { id?: string }) => {
      const cryptoKey = requireKey(wallet);
      if (data.id) {
        const body = await encodeExpenseUpdate(data, cryptoKey);
        const res = await api.expenses.update(data.id, body);
        const expense = await decodeExpense(res.expense, cryptoKey);
        return {
          expense,
          deletedIds: res.deletedIds ?? [],
          endedIds: res.endedIds ?? [],
        };
      }
      const body = await encodeExpenseCreate(data, cryptoKey);
      const { expense } = await api.expenses.create(body);
      return {
        expense: await decodeExpense(expense, cryptoKey),
        deletedIds: [] as string[],
        endedIds: [] as string[],
      };
    },
    onSuccess: ({ expense, deletedIds, endedIds }, variables) => {
      const gone = new Set(deletedIds);
      const ended = new Set(endedIds);
      const nextExpenses = (() => {
        const prev = queryClient.getQueryData<Expense[]>(keys.expenses(wallet)) ?? [];
        let next = prev.filter((e) => !gone.has(e.id));
        next = next.map((e) => {
          if (ended.has(e.id)) return { ...e, recurring: false as const };
          if (variables.id && e.id === expense.id) return expense;
          return e;
        });
        if (!variables.id) {
          next = sortExpensesByDateDesc([expense, ...next]);
        } else if (!next.some((e) => e.id === expense.id)) {
          next = sortExpensesByDateDesc([expense, ...next]);
        } else {
          next = sortExpensesByDateDesc(next);
        }
        return next;
      })();
      queryClient.setQueryData<Expense[]>(keys.expenses(wallet), nextExpenses);
      void queryClient.invalidateQueries({ queryKey: keys.allExpenses(wallet) });
      if (!variables.id) {
        setMonthMutation.mutate(expense.date.slice(0, 7));
      }

      const walletDoc = activeWallet;
      if (walletDoc && expense.kind !== "income") {
        const monthKey = expense.date.slice(0, 7);
        const scoped = nextExpenses.filter((e) => e.walletId === walletDoc.id);
        void maybeNotifyBudgetAlerts({
          expenses: scoped,
          budgets: walletDoc.budgets,
          wallet: walletDoc,
          month: monthKey,
          currency: walletDoc.currency,
          categoryIndex,
          events: queryClient.getQueryData<LedgerEvent[]>(keys.events(wallet, month)) ?? [],
        });
      }
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: ({ id, opts }: { id: string; opts?: DeleteScopeOpts }) =>
      api.expenses.remove(id, opts),
    onSuccess: (res, { id, opts }) => {
      queryClient.setQueryData<Expense[]>(keys.expenses(wallet), (prev = []) => {
        if (res.skippedId) {
          return prev.filter((e) => e.id !== res.skippedId);
        }
        if (res.deletedIds?.length) {
          const gone = new Set(res.deletedIds);
          let next = prev.filter((e) => !gone.has(e.id));

          // Futures scope also ends recurrence on remaining past rows.
          if (opts?.scope === "future" && opts.fromDate) {
            const target = prev.find((e) => e.id === id);
            if (target && normalizeRecurring(target.recurring) !== false) {
              const series = recurringScheduleKey(target);
              next = next.map((e) => {
                if (
                  normalizeRecurring(e.recurring) === false ||
                  recurringScheduleKey(e) !== series ||
                  e.date >= opts.fromDate!
                ) {
                  return e;
                }
                return { ...e, recurring: false as const };
              });
            }
          }

          return next;
        }
        return prev.filter((e) => e.id !== id);
      });
      void queryClient.invalidateQueries({ queryKey: keys.allExpenses(wallet) });
    },
  });

  const saveEventMutation = useMutation({
    mutationFn: async (data: Omit<LedgerEvent, "id"> & { id?: string }) => {
      const cryptoKey = requireKey(wallet);
      assertCustomEventFields(data);
      /* Wallet currency + hold category name are E2EE — resolve them for the email copy. */
      const reminderCtx: ReminderContext = {
        currency: activeWallet?.currency,
        holdCategoryName: data.budgetHoldCategoryId
          ? categoryIndex.catById[data.budgetHoldCategoryId]?.name
          : undefined,
      };
      if (data.id) {
        const body = await encodeEventUpdate(data, cryptoKey, reminderCtx);
        const { event } = await api.events.update(data.id, body);
        return decodeEvent(event, cryptoKey);
      }
      const body = await encodeEventCreate(data, cryptoKey, reminderCtx);
      const { event } = await api.events.create(body);
      return decodeEvent(event, cryptoKey);
    },
    onSuccess: (event, variables) => {
      const eventMonth = clampMonthKey(event.date.slice(0, 7));
      const cacheMonths = new Set([month, eventMonth]);

      for (const cacheMonth of cacheMonths) {
        queryClient.setQueryData<LedgerEvent[]>(keys.events(wallet, cacheMonth), (prev = []) => {
          if (variables.id) {
            const mapped = prev.map((e) => (e.id === event.id ? event : e));
            /* Drop from this month's cache when the event no longer occurs here as a once row. */
            if (event.repeat === "once" && eventMonth !== cacheMonth) {
              return mapped.filter((e) => e.id !== event.id);
            }
            return mapped;
          }
          if (prev.some((e) => e.id === event.id)) return prev;
          return [...prev, event];
        });
      }

      if (!variables.id) {
        setMonthMutation.mutate(eventMonth);
      }
    },
  });

  const saveCategoriesMutation = useMutation({
    mutationFn: async (categories: Category[]) => {
      const error = validateTaxonomy(categories);
      if (error) throw new Error(error);
      const cryptoKey = requireKey(wallet);
      const encrypted = await encodeCategories(categories, cryptoKey);
      await api.categories.update(encrypted);
      return categories;
    },
    onSuccess: async (categories) => {
      queryClient.setQueryData(keys.categories(wallet), categories);
      if (!activeWallet) return;
      const merged = { ...activeWallet.budgets };
      let changed = false;
      for (const cat of categories) {
        if (!isIncomeCategory(cat) && !(cat.id in merged)) {
          merged[cat.id] = 0;
          changed = true;
        }
      }
      if (changed) {
        const cryptoKey = requireKey(wallet);
        const encrypted = await encodeWalletFinancials(
          {
            name: activeWallet.name,
            income: activeWallet.income,
            startingBalance: activeWallet.startingBalance,
            budgets: merged,
          },
          cryptoKey,
        );
        const { wallet: wire } = await api.wallets.updateBudgets(activeWallet.id, encrypted);
        const updated = await decodeWallet(wire, cryptoKey);
        queryClient.setQueryData<FinancialWallet[]>(keys.wallets(wallet), (prev = []) =>
          prev.map((w) => (w.id === updated.id ? updated : w)),
        );
      }
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: async ({
      id,
      opts,
    }: {
      id: string;
      opts?: DeleteScopeOpts;
    }): Promise<{ ok: boolean; deleted?: boolean; event?: LedgerEvent }> => {
      const res = await api.events.remove(id, opts);
      if (!res.deleted && res.event) {
        const cryptoKey = requireKey(wallet);
        return {
          ...res,
          event: await decodeEvent(res.event, cryptoKey),
        };
      }
      return { ok: res.ok, deleted: res.deleted };
    },
    onSuccess: (res, { id }) => {
      queryClient.setQueryData<LedgerEvent[]>(keys.events(wallet, month), (prev = []) => {
        if (res.deleted || !res.event) {
          return prev.filter((e) => e.id !== id);
        }
        return prev.map((e) => (e.id === res.event!.id ? res.event! : e));
      });
    },
  });

  const saveTodoListMutation = useMutation({
    mutationFn: async (data: Partial<TodoList> & { id?: string; name?: string; icon?: string }) => {
      const cryptoKey = requireKey(wallet);
      const existing = queryClient.getQueryData<TodoList[]>(keys.todoLists(wallet)) ?? [];
      const name = data.name ?? "";
      const icon = data.icon ?? "📋";
      const tasks =
        data.tasks ?? (data.id ? (existing.find((l) => l.id === data.id)?.tasks ?? []) : []);

      if (name) {
        const clash = existing.find(
          (l) => l.id !== data.id && l.name.toLowerCase() === name.trim().toLowerCase(),
        );
        if (clash) throw new Error("A list with this name already exists");
      }

      if (data.id) {
        const current = existing.find((l) => l.id === data.id);
        if (!current) throw new Error("List not found");
        const encrypted = await encodeTodoListUpdate(
          {
            name: data.name ?? current.name,
            icon: data.icon ?? current.icon,
            tasks: data.tasks ?? current.tasks,
          },
          cryptoKey,
        );
        const { todoList } = await api.todoLists.update(data.id, encrypted);
        return decodeTodoList(todoList, cryptoKey);
      }

      const encrypted = await encodeTodoListCreate({ name, icon, tasks }, cryptoKey);
      const { todoList } = await api.todoLists.create(encrypted);
      return decodeTodoList(todoList, cryptoKey);
    },
    onSuccess: (saved, variables) => {
      queryClient.setQueryData<TodoList[]>(keys.todoLists(wallet), (prev = []) => {
        if (variables.id) {
          return prev.map((l) => (l.id === saved.id ? saved : l));
        }
        return [...prev, saved];
      });
    },
  });

  const deleteTodoListMutation = useMutation({
    mutationFn: (id: string) => api.todoLists.remove(id),
    onSuccess: (_res, id) => {
      queryClient.setQueryData<TodoList[]>(keys.todoLists(wallet), (prev = []) =>
        prev.filter((l) => l.id !== id),
      );
    },
  });

  const saveCapitalPlanMutation = useMutation({
    mutationFn: async (data: Partial<CapitalPlan> & { id?: string }) => {
      const cryptoKey = requireKey(wallet);
      const existing = queryClient.getQueryData<CapitalPlan[]>(keys.capitalPlans(wallet)) ?? [];

      if (data.id) {
        const current = existing.find((p) => p.id === data.id);
        if (!current) throw new Error("Plan not found");
        const merged: Omit<CapitalPlan, "id"> = {
          name: data.name ?? current.name,
          templateId: data.templateId ?? current.templateId,
          glyph: data.glyph ?? current.glyph,
          targetDate: data.targetDate ?? current.targetDate,
          initialBudget: data.initialBudget ?? current.initialBudget,
          createdAt: current.createdAt,
          items: data.items ?? current.items,
        };
        const encrypted = await encodeCapitalPlanUpdate(merged, cryptoKey);
        const { capitalPlan } = await api.capitalPlans.update(data.id, encrypted);
        return decodeCapitalPlan(capitalPlan, cryptoKey);
      }

      const fresh: Omit<CapitalPlan, "id"> = {
        name: data.name ?? "",
        templateId: data.templateId,
        glyph: data.glyph ?? "🎯",
        targetDate: data.targetDate,
        initialBudget: data.initialBudget,
        createdAt: data.createdAt ?? new Date().toISOString(),
        items: data.items ?? [],
      };
      const encrypted = await encodeCapitalPlanCreate(fresh, cryptoKey);
      const { capitalPlan } = await api.capitalPlans.create(encrypted);
      return decodeCapitalPlan(capitalPlan, cryptoKey);
    },
    onSuccess: (saved, variables) => {
      queryClient.setQueryData<CapitalPlan[]>(keys.capitalPlans(wallet), (prev = []) => {
        if (variables.id) return prev.map((p) => (p.id === saved.id ? saved : p));
        return [...prev, saved];
      });
    },
  });

  const deleteCapitalPlanMutation = useMutation({
    mutationFn: (id: string) => api.capitalPlans.remove(id),
    onSuccess: (_res, id) => {
      queryClient.setQueryData<CapitalPlan[]>(keys.capitalPlans(wallet), (prev = []) =>
        prev.filter((p) => p.id !== id),
      );
      /* Mirror the server's release into both expense caches so piggy balances
         recover now rather than after savingsAll's staleTime: `expenses` is
         windowed and feeds Insights, `savingsAll` is full history and feeds
         Piggies and the Capitals pot. */
      const release = (prev: Expense[] = []) =>
        prev.map((e) => (e.capitalPlanId === id ? { ...e, capitalPlanId: undefined } : e));
      queryClient.setQueryData<Expense[]>(keys.expenses(wallet), release);
      queryClient.setQueryData<Expense[]>(keys.allExpenses(wallet), release);
      void queryClient.invalidateQueries({ queryKey: keys.allExpenses(wallet) });
    },
  });

  const saveVehicleMutation = useMutation({
    mutationFn: async (data: Omit<Vehicle, "id" | "createdAt"> & { id?: string }) => {
      const cryptoKey = requireKey(wallet);
      const { id, ...rest } = data;
      if (id) {
        const body = await encodeVehicleUpdate(rest, cryptoKey);
        const { vehicle } = await api.vehicles.update(id, body);
        return decodeVehicle(vehicle, cryptoKey);
      }
      const body = await encodeVehicleCreate(rest, cryptoKey);
      const { vehicle } = await api.vehicles.create(body);
      return decodeVehicle(vehicle, cryptoKey);
    },
    onSuccess: (saved, variables) => {
      queryClient.setQueryData<Vehicle[]>(keys.vehicles(wallet), (prev = []) => {
        if (variables.id) return prev.map((v) => (v.id === saved.id ? saved : v));
        return [...prev, saved];
      });
    },
  });

  const deleteVehicleMutation = useMutation({
    mutationFn: (id: string) => api.vehicles.remove(id),
    onSuccess: (_res, id) => {
      queryClient.setQueryData<Vehicle[]>(keys.vehicles(wallet), (prev = []) =>
        prev.filter((v) => v.id !== id),
      );
      queryClient.setQueryData<FuelFill[]>(keys.vehicleFills(wallet), (prev = []) =>
        prev.filter((f) => f.vehicleId !== id),
      );
    },
  });

  const saveVehicleFillMutation = useMutation({
    mutationFn: async (data: Omit<FuelFill, "id"> & { id?: string }) => {
      const cryptoKey = requireKey(wallet);
      const { id, ...rest } = data;
      if (id) {
        const body = await encodeVehicleFillUpdate(rest, cryptoKey);
        const { fill } = await api.vehicles.fills.update(id, body);
        return decodeVehicleFill(fill, cryptoKey);
      }
      const body = await encodeVehicleFillCreate(rest, cryptoKey);
      const { fill } = await api.vehicles.fills.create(body);
      return decodeVehicleFill(fill, cryptoKey);
    },
    onSuccess: (saved, variables) => {
      queryClient.setQueryData<FuelFill[]>(keys.vehicleFills(wallet), (prev = []) => {
        if (variables.id) return prev.map((f) => (f.id === saved.id ? saved : f));
        return [...prev, saved];
      });
    },
  });

  const deleteVehicleFillMutation = useMutation({
    mutationFn: (id: string) => api.vehicles.fills.remove(id),
    onSuccess: (_res, id) => {
      queryClient.setQueryData<FuelFill[]>(keys.vehicleFills(wallet), (prev = []) =>
        prev.filter((f) => f.id !== id),
      );
    },
  });

  /* Overview (the first thing rendered post-login) only reads profile,
     wallets, categories and expenses — events/todoLists/capitalPlans/
     vehicles all default to `[]` (below) and render their own empty state
     exactly like savingsTxns/vehicleFills already do, so gating the whole
     app on them was blocking first paint for data no one was waiting on. */
  const isLoading =
    !cryptoReady ||
    profileQuery.isLoading ||
    walletsQuery.isLoading ||
    categoriesQuery.isLoading ||
    expensesQuery.isLoading;
  const error =
    profileQuery.error ??
    walletsQuery.error ??
    categoriesQuery.error ??
    expensesQuery.error ??
    eventsQuery.error ??
    todoListsQuery.error ??
    capitalPlansQuery.error ??
    vehiclesQuery.error;

  /**
   * Remap expenses from source subs onto dest, paced so a large ledger cannot
   * stall the PWA. Cache is written once at the end. Budget merge and hold
   * remaps run after a whole-category source finishes.
   */
  const transferHistory = useCallback(
    async (args: {
      sourceSubIds: string[];
      destSubId: string;
      destType: CategoryType;
      destCatId: string;
      sourceCatId?: string;
      onProgress: (done: number, total: number) => void;
    }) => {
      const cryptoKey = requireKey(wallet);
      const matching = expensesMatchingSubs(
        allExpensesQuery.data ?? [],
        new Set(args.sourceSubIds),
      );
      const clearCapital = args.destType !== "savings";

      const result = await runPacedTransfer(
        matching,
        async (expense) => {
          const next = applyTransferFields(expense, args.destSubId, args.destType);
          const body = await encodeExpenseUpdate(
            {
              sub: next.sub,
              amount: next.amount,
              note: next.note ?? "",
              kind: next.kind,
              walletId: next.walletId,
              ...(clearCapital ? { capitalPlanId: "" } : {}),
              ...(next.recurring ? { recurring: next.recurring } : {}),
            },
            cryptoKey,
          );
          await api.expenses.update(expense.id, body);
        },
        { onProgress: args.onProgress },
      );

      if (result.completed.length) {
        const doneIds = new Set(result.completed.map((e) => e.id));
        const apply = (prev: Expense[] = []) =>
          prev.map((e) =>
            doneIds.has(e.id) ? applyTransferFields(e, args.destSubId, args.destType) : e,
          );
        queryClient.setQueryData<Expense[]>(keys.expenses(wallet), apply);
        queryClient.setQueryData<Expense[]>(keys.allExpenses(wallet), apply);
      }

      if (result.remaining.length) {
        return {
          remainingIds: result.remaining.map((e) => e.id),
          error: result.error instanceof Error ? result.error.message : "Transfer failed",
        };
      }

      if (args.sourceCatId) {
        const destTakesBudget = args.destType !== "income";
        for (const w of walletsQuery.data ?? []) {
          const nextBudgets = mergeCategoryBudget(
            w.budgets,
            args.sourceCatId,
            args.destCatId,
            destTakesBudget,
          );
          const sameKeys =
            Object.keys(nextBudgets).length === Object.keys(w.budgets).length &&
            Object.keys(nextBudgets).every((k) => nextBudgets[k] === w.budgets[k]);
          if (sameKeys) continue;
          await saveWalletMutation.mutateAsync({ id: w.id, budgets: nextBudgets });
        }

        const destHoldId = args.destType === "expense" ? args.destCatId : undefined;
        const monthEvents =
          queryClient.getQueryData<LedgerEvent[]>(keys.events(wallet, month)) ?? [];
        const toRemap = monthEvents.filter((ev) => ev.budgetHoldCategoryId === args.sourceCatId);
        if (toRemap.length) {
          const holdResult = await runPacedTransfer(toRemap, async (event) => {
            const updated: LedgerEvent = destHoldId
              ? { ...event, budgetHoldCategoryId: destHoldId }
              : { ...event, budgetHoldEnabled: false };
            const reminderCtx: ReminderContext = {
              currency: activeWallet?.currency,
              holdCategoryName: destHoldId ? categoryIndex.catById[destHoldId]?.name : undefined,
            };
            const body = await encodeEventUpdate(updated, cryptoKey, reminderCtx);
            await api.events.update(event.id, body);
          });
          if (!holdResult.remaining.length) {
            const remapped = new Set(toRemap.map((e) => e.id));
            queryClient.setQueryData<LedgerEvent[]>(keys.events(wallet, month), (prev = []) =>
              prev.map((ev) => {
                if (!remapped.has(ev.id)) return ev;
                return destHoldId
                  ? { ...ev, budgetHoldCategoryId: destHoldId }
                  : { ...ev, budgetHoldEnabled: false };
              }),
            );
          }
        }
      }

      return { remainingIds: [] as string[] };
    },
    [
      wallet,
      allExpensesQuery.data,
      queryClient,
      walletsQuery.data,
      saveWalletMutation,
      month,
      activeWallet?.currency,
      categoryIndex.catById,
    ],
  );

  return {
    profile: profileQuery.data,
    wallets,
    activeWallet,
    allExpenses,
    expenses,
    savingsTxns,
    balanceExpenses,
    usedSubIds,
    savingsLoading: allExpensesQuery.isLoading,
    events: eventsQuery.data ?? [],
    eventsLoading: eventsQuery.isLoading,
    todoLists: todoListsQuery.data ?? [],
    todoListsLoading: todoListsQuery.isLoading,
    capitalPlans: capitalPlansQuery.data ?? [],
    capitalPlansLoading: capitalPlansQuery.isLoading,
    vehicles: vehiclesQuery.data ?? [],
    vehiclesLoading: vehiclesQuery.isLoading,
    vehicleFills: vehicleFillsQuery.data ?? [],
    vehicleFillsLoading: vehicleFillsQuery.isLoading,
    budgets: activeWallet?.budgets ?? {},
    wallet: activeWallet,
    currency: activeWallet?.currency ?? "MYR",
    categoryIndex,
    month,
    cryptoReady,
    isLoading,
    error,
    setActiveWalletId,
    tourPreference: profileQuery.data?.tourPreference ?? "pending",
    toursSeen: profileQuery.data?.toursSeen ?? EMPTY_TOURS_SEEN,
    setTourState: setTourStateMutation.mutateAsync,
    setMonth: (currentMonth: string) => setMonthMutation.mutate(currentMonth),
    isMonthPending: setMonthMutation.isPending,
    setBudgets: (budgets: Budgets) => setBudgetsMutation.mutate(budgets),
    saveCategories: saveCategoriesMutation.mutateAsync,
    transferHistory,
    saveWallet: saveWalletMutation.mutateAsync,
    deleteWallet: deleteWalletMutation.mutateAsync,
    saveExpense: saveExpenseMutation.mutateAsync,
    deleteExpense: (id: string, opts?: DeleteScopeOpts) =>
      deleteExpenseMutation.mutateAsync({ id, opts }),
    saveEvent: saveEventMutation.mutateAsync,
    deleteEvent: (id: string, opts?: DeleteScopeOpts) =>
      deleteEventMutation.mutateAsync({ id, opts }),
    saveTodoList: saveTodoListMutation.mutateAsync,
    deleteTodoList: deleteTodoListMutation.mutateAsync,
    saveCapitalPlan: saveCapitalPlanMutation.mutateAsync,
    deleteCapitalPlan: deleteCapitalPlanMutation.mutateAsync,
    saveVehicle: saveVehicleMutation.mutateAsync,
    deleteVehicle: deleteVehicleMutation.mutateAsync,
    saveVehicleFill: saveVehicleFillMutation.mutateAsync,
    deleteVehicleFill: deleteVehicleFillMutation.mutateAsync,
    isBudgetsPending: setBudgetsMutation.isPending,
    isSaving:
      setBudgetsMutation.isPending ||
      saveExpenseMutation.isPending ||
      deleteExpenseMutation.isPending ||
      saveEventMutation.isPending ||
      deleteEventMutation.isPending ||
      saveWalletMutation.isPending ||
      deleteWalletMutation.isPending ||
      saveCategoriesMutation.isPending ||
      saveTodoListMutation.isPending ||
      deleteTodoListMutation.isPending ||
      saveCapitalPlanMutation.isPending ||
      deleteCapitalPlanMutation.isPending ||
      saveVehicleMutation.isPending ||
      deleteVehicleMutation.isPending ||
      saveVehicleFillMutation.isPending ||
      deleteVehicleFillMutation.isPending,
  };
}
