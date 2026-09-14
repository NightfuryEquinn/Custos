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
  type CapitalPlanWire,
  type CategoriesWire,
  type EventWire,
  type ExpenseWire,
  type ReminderContext,
  type TodoListWire,
  type VehicleFillWire,
  type VehicleWire,
} from "@/frontend/lib/crypto/codec";
import { ledgerKeyStore, seriesKeyStore } from "@/frontend/lib/crypto/key-store";
import { connectivity } from "@/frontend/lib/net/connectivity";
import { clientObjectId } from "@/frontend/lib/sync/object-id";
import { discardOutbox, enqueueOutbox, listOutbox } from "@/frontend/lib/sync/outbox";
import { drainOutbox } from "@/frontend/lib/sync/engine";
import {
  capitalPlanOverlay,
  eventOverlay,
  expenseOverlay,
  todoListOverlay,
  vehicleFillOverlay,
  vehicleOverlay,
  walletBudgetsOverlay,
} from "@/frontend/lib/sync/overlay";
import { usePendingOverlay, usePendingSingletonOverlay } from "@/frontend/lib/sync/useOutbox";
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
import { resolveEventDeleteAction, type DeleteScope } from "@/lib/delete-scope";
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

/** Require the unlocked series-HMAC key for the given address. */
function requireSeriesKey(address: string): CryptoKey {
  const key = seriesKeyStore.get(address);
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
             load shouldn't block on a one-time migration write. Skipped
             offline (this data may itself be a stale cache-fallback read) —
             a later online load retries it. */
          if ((!wire.enc || wire.name != null) && connectivity.isOnline()) {
            /* Also skip while a "walletBudgets" write for this wallet is
               still queued — this migration write would otherwise race it
               with stale (pre-overlay) budgets and clobber whichever lands
               second. Vanishingly rare in practice (it takes a legacy
               plaintext wallet with a queued offline budgets edit), but
               free to check. */
            void listOutbox(wallet)
              .then(async (queued) => {
                if (queued.some((e) => e.entity === "walletBudgets" && e.targetId === wire.id)) {
                  return;
                }
                const encrypted = await encodeWalletFinancials(
                  {
                    name: decoded.name,
                    income: decoded.income,
                    startingBalance: decoded.startingBalance,
                    budgets: decoded.budgets,
                  },
                  cryptoKey,
                );
                await api.wallets.update(wire.id, encrypted);
              })
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
         doesn't need to wait for the write to land. Skipped offline, and
         skipped whenever a "categories" write is already queued — either
         branch would otherwise be a stale write racing (and possibly
         clobbering) the user's own queued taxonomy with defaults or a
         legacy copy. A later online load, once the queue has drained,
         retries whichever of these is still actually true. */
      if (wire.seed) {
        const defaults = cloneDefaultCategories();
        if (connectivity.isOnline()) {
          void listOutbox(wallet)
            .then(async (queued) => {
              if (queued.some((e) => e.entity === "categories")) return;
              const encrypted = await encodeCategories(defaults, cryptoKey);
              await api.categories.update(encrypted);
            })
            .catch(() => {
              /* A later load retries seeding. */
            });
        }
        return defaults;
      }

      if (!wire.enc && wire.categories) {
        if (connectivity.isOnline()) {
          void listOutbox(wallet)
            .then(async (queued) => {
              if (queued.some((e) => e.entity === "categories")) return;
              const encrypted = await encodeCategories(wire.categories!, cryptoKey);
              await api.categories.update(encrypted);
            })
            .catch(() => {
              /* A later load retries the migration. */
            });
        }
        return wire.categories;
      }

      return decodeCategories(wire, cryptoKey);
    },
    enabled: cryptoReady,
  });

  /* Pending offline categories/budget writes layered onto the server-derived
     data — see src/frontend/lib/sync/overlay.ts. `activeWallet` (below) and
     `categoryIndex` both read the overlaid versions, not the raw query
     data, so a queued budgets edit isn't reverted by the next thing that
     happens to re-encrypt the same wallet's secrets blob (setBudgetsMutation
     and saveCategoriesMutation's own second write both go through this same
     overlay-then-encode path — see those mutations below). */
  const overlaidWalletsData = usePendingOverlay(
    wallet,
    walletsQuery.data,
    ledgerKeyStore.get(wallet),
    walletBudgetsOverlay,
  );
  const overlaidCategoriesData = usePendingSingletonOverlay(
    wallet,
    "categories",
    categoriesQuery.data,
    ledgerKeyStore.get(wallet),
    "categories",
    (body, key) => decodeCategories(body as CategoriesWire, key),
  );

  const categoryIndex = useMemo(
    () => buildCategoryIndex(overlaidCategoriesData ?? []),
    [overlaidCategoriesData],
  );

  const month = clampMonthKey(profileQuery.data?.currentMonth ?? CURRENT_MONTH_KEY);

  const wallets = overlaidWalletsData.map((w) => ({
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

  /* Pending offline creates/updates layered on top of the server-derived
     plans — see src/frontend/lib/sync/overlay.ts. `livePlans` below reads
     this, not the raw query data: a plan created offline and immediately
     logged against (mark-item-paid, still offline) must count as "live", or
     releaseOrphanedPlanRefs would strip the just-set capitalPlanId back off
     the expense before the plan's own create ever confirms. */
  const overlaidCapitalPlanData = usePendingOverlay(
    wallet,
    capitalPlansQuery.data,
    ledgerKeyStore.get(wallet),
    capitalPlanOverlay,
  );

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
    () => (capitalPlansQuery.isSuccess ? overlaidCapitalPlanData : null),
    [capitalPlansQuery.isSuccess, overlaidCapitalPlanData],
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

  /* Pending offline creates/updates/deletes layered on top of the
     server-derived rows — see src/frontend/lib/sync/overlay.ts. Rebuilt
     from the durable outbox on every render, so it survives a reload while
     still offline (unlike an in-memory optimistic patch). */
  const overlaidExpenseData = usePendingOverlay(
    wallet,
    expensesQuery.data,
    ledgerKeyStore.get(wallet),
    expenseOverlay,
  );

  /* Was a bare .map() in the render body — re-running over up to 10,000 rows
     on every LedgerApp render (any modal open, any FAB toggle), not just
     when the underlying data actually changed. */
  const decodedExpenses = useMemo(
    () =>
      overlaidExpenseData.map((e) => ({
        ...e,
        kind: e.kind ?? "expense",
        recurring: normalizeRecurring(e.recurring),
      })),
    [overlaidExpenseData],
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

  /* Same overlay as expensesQuery above — without it, an expense created or
     edited offline would show in the windowed ledger list but silently miss
     piggy balances, starting-mode wallet balance, and usedSubIds, all of
     which read from this unbounded query instead. */
  const overlaidAllExpenseData = usePendingOverlay(
    wallet,
    allExpensesQuery.data,
    ledgerKeyStore.get(wallet),
    expenseOverlay,
  );

  /* Decode + heal once, shared by savingsTxns and balanceExpenses below —
     these used to each redo the same map + releaseOrphanedPlanRefs pass over
     up to 40,000 rows independently. */
  const allExpensesHealed = useMemo(() => {
    const decoded = overlaidAllExpenseData.map((e) => ({
      ...e,
      kind: e.kind ?? "expense",
      recurring: normalizeRecurring(e.recurring),
    }));
    return livePlans ? releaseOrphanedPlanRefs(decoded, livePlans) : decoded;
  }, [overlaidAllExpenseData, livePlans]);

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
    const subs = new Set(overlaidAllExpenseData.map((e) => e.sub));
    for (const e of overlaidExpenseData) subs.add(e.sub);

    return subs;
  }, [allExpensesQuery.isSuccess, overlaidAllExpenseData, overlaidExpenseData]);

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
            /* Migrate a legacy plaintext event into the E2EE payload. Only
               attempted online — this data may itself be a stale
               cache-fallback read, and the write would hard-fail offline
               anyway; either way, decode `wire` directly and let a later
               online load retry the migration. */
            if (!wire.enc && wire.title && connectivity.isOnline()) {
              try {
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
              } catch {
                /* A later load retries the migration. */
              }
            }

            return decodeEvent(wire, cryptoKey);
          }),
        );

        /* Fire-and-forget: notifyDetails only affects a future reminder send,
           not anything this load renders, so it shouldn't hold up the query.
           Skipped offline; a later online load retries. */
        if (connectivity.isOnline()) {
          void backfillReminderDetails(
            page.events.map((wire, i) => ({ wire, event: decoded[i]! })),
            activeWallet?.currency,
            categoryIndex.catById,
          );
        }

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
          if (!wire.enc && wire.name && connectivity.isOnline()) {
            /* Fire-and-forget: decoding `wire` directly already gives the
               same result the round trip's echo would, so this load
               doesn't need to wait for the migration write to land.
               Skipped offline, and skipped while this list already has a
               queued write — this stale-cache-derived migration would
               otherwise race a real, newer offline edit. A later online
               load, once drained, retries if still needed. */
            void listOutbox(wallet)
              .then(async (queued) => {
                if (queued.some((e) => e.entity === "todoList" && e.targetId === wire.id)) return;
                const encrypted = await encodeTodoListUpdate(
                  { name: wire.name!, icon: wire.icon ?? "📋", tasks: wire.tasks ?? [] },
                  cryptoKey,
                );
                await api.todoLists.update(wire.id, encrypted);
              })
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

  /* Pending offline creates/updates layered over the server-derived rows —
     see src/frontend/lib/sync/overlay.ts. Events aren't filtered to the
     currently-viewed month here: a pending create/update decodes to its own
     real date, but this month-scoped query has no local way to know whether
     a *different* month's cache should also show it, so an offline edit to
     an event outside the current month can surface here until it confirms
     and the query is invalidated. Cosmetic — self-corrects on drain. */
  const overlaidEventData = usePendingOverlay(
    wallet,
    eventsQuery.data,
    ledgerKeyStore.get(wallet),
    eventOverlay,
  );
  const overlaidTodoListData = usePendingOverlay(
    wallet,
    todoListsQuery.data,
    ledgerKeyStore.get(wallet),
    todoListOverlay,
  );
  const overlaidVehicleData = usePendingOverlay(
    wallet,
    vehiclesQuery.data,
    ledgerKeyStore.get(wallet),
    vehicleOverlay,
  );
  const overlaidVehicleFillData = usePendingOverlay(
    wallet,
    vehicleFillsQuery.data,
    ledgerKeyStore.get(wallet),
    vehicleFillOverlay,
  );

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
      /* A pure $set of {enc, payload} server-side (PUT /wallets/:id/budgets)
         with no side effects and no server-only precondition — safe to
         queue unconditionally, unlike wallet create/rename/set-default/
         delete (still online-only; each has a server-computed or
         server-only precondition the client can't reproduce). `activeWallet`
         here is already overlay-aware (see overlaidWalletsData above), so a
         second queued budgets edit sees the first one's numbers instead of
         the last-confirmed server state. */
      const encrypted = await encodeWalletFinancials(
        {
          name: activeWallet.name,
          income: activeWallet.income,
          startingBalance: activeWallet.startingBalance,
          budgets,
        },
        cryptoKey,
      );
      await enqueueOutbox({
        address: wallet,
        entity: "walletBudgets",
        op: "update",
        targetId: activeWallet.id,
        request: { method: "PUT", path: `/wallets/${activeWallet.id}/budgets`, body: encrypted },
        dependsOn: [],
        label: "Budgets",
      });
      void drainOutbox(wallet);
    },
  });

  const saveWalletMutation = useMutation({
    mutationFn: async (
      data: Partial<FinancialWallet> & { id?: string; name?: string; currency?: string },
    ) => {
      const cryptoKey = requireKey(wallet);
      if (data.id) {
        /* Overlay-aware, not the raw query cache: this stays online-only
           (wallet rename/currency/default), but its own financial-blob
           fallback must still see a budgets edit still queued from an
           earlier offline session, or this write would silently revert it
           the moment it lands. */
        const existing = overlaidWalletsData.find((w) => w.id === data.id);
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
      const seriesHmacKey = requireSeriesKey(wallet);

      if (data.id) {
        /* Safe to queue offline only when the expense being edited is not
           currently part of a recurring series — shouldRetireOldExpenseSeries
           (src/api/lib/expense-delete-scope.ts) never retires anything for
           an expense whose *existing* recurring value is already false,
           regardless of what the edit changes it to. Editing an
           already-recurring row can trigger a server-computed multi-document
           retire, which the client cannot predict — that case keeps requiring
           a live connection, unchanged from before this queue existed. */
        const existing =
          expensesQuery.data?.find((e) => e.id === data.id) ??
          allExpensesQuery.data?.find((e) => e.id === data.id);
        const queueable = existing ? normalizeRecurring(existing.recurring) === false : false;
        const body = await encodeExpenseUpdate(data, cryptoKey, seriesHmacKey);

        if (queueable) {
          await enqueueOutbox({
            address: wallet,
            entity: "expense",
            op: "update",
            targetId: data.id,
            request: { method: "PATCH", path: `/expenses/${data.id}`, body },
            dependsOn: [],
            label: data.note || "Expense",
          });
          void drainOutbox(wallet);
          const expense = await decodeExpense({ id: data.id, ...body } as ExpenseWire, cryptoKey);
          return { expense, deletedIds: [] as string[], endedIds: [] as string[] };
        }

        const res = await api.expenses.update(data.id, body);
        const expense = await decodeExpense(res.expense, cryptoKey);
        return {
          expense,
          deletedIds: res.deletedIds ?? [],
          endedIds: res.endedIds ?? [],
        };
      }

      /* A brand-new expense never retires anything — always safe to queue,
         recurring or not. Client-mints the id so the row (and anything that
         links to it — an event, a Capitals plan) is final immediately. */
      const id = clientObjectId();
      const body = await encodeExpenseCreate(data, cryptoKey, seriesHmacKey);
      await enqueueOutbox({
        address: wallet,
        entity: "expense",
        op: "create",
        targetId: id,
        request: { method: "POST", path: "/expenses", body: { id, ...body } },
        dependsOn: [],
        label: data.note || "Expense",
      });
      void drainOutbox(wallet);
      const expense = await decodeExpense({ id, ...body } as ExpenseWire, cryptoKey);
      return {
        expense,
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
    mutationFn: async ({ id, opts }: { id: string; opts?: DeleteScopeOpts }) => {
      /* A scope-based delete has the server compute deletedIds/skippedId
         across potentially many rows and cascade-unlink events/fills — that
         can't be predicted client-side, so it keeps requiring a live
         connection, unchanged. A scopeless delete is always a single
         document (recurring or not — the server only takes the scoped path
         when `scope` is present), so it's always safe to queue. */
      if (!opts?.scope) {
        await enqueueOutbox({
          address: wallet,
          entity: "expense",
          op: "delete",
          targetId: id,
          request: { method: "DELETE", path: `/expenses/${id}` },
          dependsOn: [],
          label: "Delete expense",
        });
        void drainOutbox(wallet);
        return { ok: true, deletedIds: [id] as string[] | undefined, skippedId: undefined };
      }
      return api.expenses.remove(id, opts);
    },
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
      /* Both create and update are single-document, and a replayed PATCH is
         a no-op server-side (src/api/routes/events.ts) — safe to queue
         unconditionally, the same "outbox first" pattern as expenses.
         Queued whether online or offline: this trades synchronous
         server-side validation errors (e.g. an invalid lead/allDay
         combination) for the retry/discard panel on the rare mismatch, in
         exchange for reads/writes never blocking on the network. */
      if (data.id) {
        const body = await encodeEventUpdate(data, cryptoKey, reminderCtx);
        await enqueueOutbox({
          address: wallet,
          entity: "event",
          op: "update",
          targetId: data.id,
          request: { method: "PATCH", path: `/events/${data.id}`, body },
          dependsOn: [],
          label: data.title || "Event",
        });
        void drainOutbox(wallet);
        return decodeEvent({ id: data.id, ...body } as EventWire, cryptoKey);
      }
      const id = clientObjectId();
      const body = await encodeEventCreate(data, cryptoKey, reminderCtx);
      await enqueueOutbox({
        address: wallet,
        entity: "event",
        op: "create",
        targetId: id,
        request: { method: "POST", path: "/events", body: { id, ...body } },
        dependsOn: [],
        label: data.title || "Event",
      });
      void drainOutbox(wallet);
      return decodeEvent({ id, ...body } as EventWire, cryptoKey);
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
      /* PUT /categories is a single account-wide upsert with no validation
         and no side effects — replaying it is a pure no-op — so it's safe
         to queue unconditionally, same reasoning as todo lists/capital
         plans. Computed here at enqueue time rather than in an onSuccess
         chained off the (possibly much later) drain response, so the
         budgets write below is pinned to *this* wallet and *this* taxonomy
         snapshot, not whatever `activeWallet` happens to resolve to when
         the queued write eventually sends. */
      const encrypted = await encodeCategories(categories, cryptoKey);
      await enqueueOutbox({
        address: wallet,
        entity: "categories",
        op: "update",
        targetId: "categories",
        request: { method: "PUT", path: "/categories", body: encrypted },
        dependsOn: [],
        label: "Categories",
      });

      /* A newly-added non-income category needs a $0 budget entry so it
         shows up in the Budgets view — mirrors the online onSuccess chain
         this replaces. No dependsOn on the categories entry above: the
         budgets write doesn't need the category doc to exist server-side
         (PUT /wallets/:id/budgets has no such precondition), and the drain
         is already strict seq order, so it always sends second regardless. */
      if (activeWallet) {
        const merged = { ...activeWallet.budgets };
        let changed = false;
        for (const cat of categories) {
          if (!isIncomeCategory(cat) && !(cat.id in merged)) {
            merged[cat.id] = 0;
            changed = true;
          }
        }
        if (changed) {
          const walletEncrypted = await encodeWalletFinancials(
            {
              name: activeWallet.name,
              income: activeWallet.income,
              startingBalance: activeWallet.startingBalance,
              budgets: merged,
            },
            cryptoKey,
          );
          await enqueueOutbox({
            address: wallet,
            entity: "walletBudgets",
            op: "update",
            targetId: activeWallet.id,
            request: {
              method: "PUT",
              path: `/wallets/${activeWallet.id}/budgets`,
              body: walletEncrypted,
            },
            dependsOn: [],
            label: "Budgets",
          });
        }
      }

      void drainOutbox(wallet);
      return categories;
    },
    onSuccess: (categories) => {
      queryClient.setQueryData(keys.categories(wallet), categories);
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
      /* Unlike an expense's scoped delete, every branch here is a single
         document (src/api/routes/events.ts) — a hard `deleteOne`, or an
         idempotent `$addToSet`/absolute `$set` that only trims the
         schedule — and resolveEventDeleteAction (@/lib/delete-scope) is
         pure shared code, so the outcome is predictable client-side from
         the cached row. Queueable whenever that row is available; falls
         back to the direct online call otherwise (e.g. a stale cache miss). */
      const existing =
        overlaidEventData.find((e) => e.id === id) ?? eventsQuery.data?.find((e) => e.id === id);
      if (existing) {
        const repeating = Boolean(existing.repeat && existing.repeat !== "once");
        const effectiveScope = repeating ? (opts?.scope ?? "all") : "all";
        const fromDate = opts?.fromDate ?? existing.date;
        const action =
          effectiveScope === "all"
            ? ({ type: "delete" } as const)
            : resolveEventDeleteAction(effectiveScope, existing.date, fromDate);

        const params = new URLSearchParams();
        if (opts?.scope) params.set("scope", opts.scope);
        params.set("fromDate", fromDate);
        const path = `/events/${id}?${params.toString()}`;

        if (action.type === "delete") {
          await enqueueOutbox({
            address: wallet,
            entity: "event",
            op: "delete",
            targetId: id,
            request: { method: "DELETE", path },
            dependsOn: [],
            label: "Delete event",
          });
          void drainOutbox(wallet);
          return { ok: true, deleted: true };
        }

        const overlayPatch =
          action.type === "except"
            ? { exceptDates: [...(existing.exceptDates ?? []), action.date] }
            : { until: action.until };
        await enqueueOutbox({
          address: wallet,
          entity: "event",
          op: "delete",
          targetId: id,
          request: { method: "DELETE", path },
          dependsOn: [],
          overlayPatch,
          label: "Delete event",
        });
        void drainOutbox(wallet);
        return { ok: true, deleted: false, event: { ...existing, ...overlayPatch } };
      }

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
      /* Reads the overlay, not the raw query cache — two offline edits to the
         same list (or a create immediately followed by an edit) must see
         each other, since encodeTodoListUpdate always sends the whole list. */
      const existing = overlaidTodoListData;
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

      /* Every request here is a full-blob $set (src/api/routes/todo-lists.ts)
         with no side effects — safe to queue unconditionally. This is also
         the case the update-over-update coalescing rule
         (@/frontend/lib/sync/outbox.ts) was written for: N queued checkbox
         toggles on the same list collapse to one send, and since each is
         already a complete snapshot, that's exactly equivalent to sending
         all N. */
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
        await enqueueOutbox({
          address: wallet,
          entity: "todoList",
          op: "update",
          targetId: data.id,
          request: { method: "PATCH", path: `/todo-lists/${data.id}`, body: encrypted },
          dependsOn: [],
          label: data.name ?? current.name,
        });
        void drainOutbox(wallet);
        return decodeTodoList({ id: data.id, ...encrypted } as TodoListWire, cryptoKey);
      }

      const id = clientObjectId();
      const encrypted = await encodeTodoListCreate({ name, icon, tasks }, cryptoKey);
      await enqueueOutbox({
        address: wallet,
        entity: "todoList",
        op: "create",
        targetId: id,
        request: { method: "POST", path: "/todo-lists", body: { id, ...encrypted } },
        dependsOn: [],
        label: name,
      });
      void drainOutbox(wallet);
      return decodeTodoList({ id, ...encrypted } as TodoListWire, cryptoKey);
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
    mutationFn: async (id: string) => {
      await enqueueOutbox({
        address: wallet,
        entity: "todoList",
        op: "delete",
        targetId: id,
        request: { method: "DELETE", path: `/todo-lists/${id}` },
        dependsOn: [],
        label: "Delete list",
      });
      void drainOutbox(wallet);
      return { ok: true };
    },
    onSuccess: (_res, id) => {
      queryClient.setQueryData<TodoList[]>(keys.todoLists(wallet), (prev = []) =>
        prev.filter((l) => l.id !== id),
      );
    },
  });

  const saveCapitalPlanMutation = useMutation({
    mutationFn: async (data: Partial<CapitalPlan> & { id?: string }) => {
      const cryptoKey = requireKey(wallet);
      /* Overlay-merged, not the raw query cache — see saveTodoListMutation;
         the same full-blob-replace shape and the same clobber risk applies. */
      const existing = overlaidCapitalPlanData;

      /* Full-blob $set with no side effects (src/api/routes/capital-plans.ts)
         — safe to queue unconditionally, same as todo lists. This is also
         what makes "log to ledger" (LedgerApp.tsx marking a plan item paid
         right after saving its expense) work while offline: without this,
         the expense would queue but the plan update marking it paid would
         silently fail. */
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
        await enqueueOutbox({
          address: wallet,
          entity: "capitalPlan",
          op: "update",
          targetId: data.id,
          request: { method: "PATCH", path: `/capital-plans/${data.id}`, body: encrypted },
          dependsOn: [],
          label: merged.name,
        });
        void drainOutbox(wallet);
        return decodeCapitalPlan({ id: data.id, ...encrypted } as CapitalPlanWire, cryptoKey);
      }

      const id = clientObjectId();
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
      await enqueueOutbox({
        address: wallet,
        entity: "capitalPlan",
        op: "create",
        targetId: id,
        request: { method: "POST", path: "/capital-plans", body: { id, ...encrypted } },
        dependsOn: [],
        label: fresh.name,
      });
      void drainOutbox(wallet);
      return decodeCapitalPlan({ id, ...encrypted } as CapitalPlanWire, cryptoKey);
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
      /* Both encoders are pure functions of `rest` — no cache read, so
         there's no RMW seam to worry about (unlike wallets/categories). Both
         server routes are single-document and $set-only/insertOwned — safe
         to queue unconditionally. */
      if (id) {
        const body = await encodeVehicleUpdate(rest, cryptoKey);
        await enqueueOutbox({
          address: wallet,
          entity: "vehicle",
          op: "update",
          targetId: id,
          request: { method: "PATCH", path: `/vehicles/${id}`, body },
          dependsOn: [],
          label: rest.name,
        });
        void drainOutbox(wallet);
        return decodeVehicle({ id, ...body } as VehicleWire, cryptoKey);
      }
      const newId = clientObjectId();
      const body = await encodeVehicleCreate(rest, cryptoKey);
      /* Neither encoder emits `createdAt` (the server sets it) — carried in
         overlayPatch instead of the request body, so it stays stable across
         re-renders and isn't sent as an unrecognized field. */
      const createdAt = new Date().toISOString();
      await enqueueOutbox({
        address: wallet,
        entity: "vehicle",
        op: "create",
        targetId: newId,
        request: { method: "POST", path: "/vehicles", body: { id: newId, ...body } },
        dependsOn: [],
        overlayPatch: { createdAt },
        label: rest.name,
      });
      void drainOutbox(wallet);
      return decodeVehicle({ id: newId, ...body, createdAt } as VehicleWire, cryptoKey);
    },
    onSuccess: (saved, variables) => {
      queryClient.setQueryData<Vehicle[]>(keys.vehicles(wallet), (prev = []) => {
        if (variables.id) return prev.map((v) => (v.id === saved.id ? saved : v));
        return [...prev, saved];
      });
    },
  });

  const deleteVehicleMutation = useMutation({
    mutationFn: async (id: string) => {
      /* Server-side this is one deleteOne + one deleteMany cascade over its
         fills (src/api/routes/vehicles.ts) — both idempotent, and a replay
         404s before the cascade runs, which the engine already treats as
         success. Cancel any still-queued (not yet sent) fill entries for
         this vehicle now, rather than letting them fail against a vehicle
         that's about to be gone. */
      const queued = await listOutbox(wallet);
      for (const entry of queued) {
        if (
          entry.entity === "vehicleFill" &&
          entry.status !== "inflight" &&
          (entry.request.body as Record<string, unknown> | undefined)?.vehicleId === id
        ) {
          await discardOutbox(entry.opId);
        }
      }
      await enqueueOutbox({
        address: wallet,
        entity: "vehicle",
        op: "delete",
        targetId: id,
        request: { method: "DELETE", path: `/vehicles/${id}` },
        dependsOn: [],
        label: "Delete vehicle",
      });
      void drainOutbox(wallet);
      return { ok: true };
    },
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
      /* A create waiting on a not-yet-confirmed vehicle create must not send
         before it — POST /vehicles/fills 404s if the vehicle doesn't exist
         yet (src/api/routes/vehicles.ts:126). The drain is already strict
         seq order, so this only matters for the failure-cascade case
         (a vehicle create that fails permanently should block its fills
         rather than firing them at a parent that'll never exist) — see
         failOutboxPermanently in outbox.ts. */
      const pendingVehicle = !id
        ? (await listOutbox(wallet)).find(
            (e) => e.entity === "vehicle" && e.op === "create" && e.targetId === rest.vehicleId,
          )
        : undefined;

      if (id) {
        const body = await encodeVehicleFillUpdate(rest, cryptoKey);
        await enqueueOutbox({
          address: wallet,
          entity: "vehicleFill",
          op: "update",
          targetId: id,
          request: { method: "PATCH", path: `/vehicles/fills/${id}`, body },
          dependsOn: [],
          label: rest.station,
        });
        void drainOutbox(wallet);
        return decodeVehicleFill({ id, ...body } as VehicleFillWire, cryptoKey);
      }
      const newId = clientObjectId();
      const body = await encodeVehicleFillCreate(rest, cryptoKey);
      await enqueueOutbox({
        address: wallet,
        entity: "vehicleFill",
        op: "create",
        targetId: newId,
        request: { method: "POST", path: "/vehicles/fills", body: { id: newId, ...body } },
        dependsOn: pendingVehicle ? [pendingVehicle.opId] : [],
        label: rest.station,
      });
      void drainOutbox(wallet);
      return decodeVehicleFill({ id: newId, ...body } as VehicleFillWire, cryptoKey);
    },
    onSuccess: (saved, variables) => {
      queryClient.setQueryData<FuelFill[]>(keys.vehicleFills(wallet), (prev = []) => {
        if (variables.id) return prev.map((f) => (f.id === saved.id ? saved : f));
        return [...prev, saved];
      });
    },
  });

  const deleteVehicleFillMutation = useMutation({
    mutationFn: async (id: string) => {
      await enqueueOutbox({
        address: wallet,
        entity: "vehicleFill",
        op: "delete",
        targetId: id,
        request: { method: "DELETE", path: `/vehicles/fills/${id}` },
        dependsOn: [],
        label: "Delete fill",
      });
      void drainOutbox(wallet);
      return { ok: true };
    },
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
      const seriesHmacKey = requireSeriesKey(wallet);
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
            seriesHmacKey,
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
        for (const w of overlaidWalletsData) {
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
      overlaidWalletsData,
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
    events: overlaidEventData,
    eventsLoading: eventsQuery.isLoading,
    todoLists: overlaidTodoListData,
    todoListsLoading: todoListsQuery.isLoading,
    capitalPlans: overlaidCapitalPlanData,
    capitalPlansLoading: capitalPlansQuery.isLoading,
    vehicles: overlaidVehicleData,
    vehiclesLoading: vehiclesQuery.isLoading,
    vehicleFills: overlaidVehicleFillData,
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
