import { AccountMenu } from "@/frontend/auth";
import { TourWelcomeModal } from "@/frontend/auth/components/TourWelcomeModal";
import { WhatsNewModal } from "@/frontend/auth/components/WhatsNewModal";
import type { LedgerBackupPlain } from "@/frontend/auth/lib/encrypted-backup";
import type { EventImportRow } from "@/frontend/auth/lib/import-events";
import type { TodoImportList } from "@/frontend/auth/lib/import-todos";
import { restoreBackupToLedger } from "@/frontend/auth/lib/restore-backup";
import { useEnter } from "@/frontend/lib/animate";
import { LoadingBloom } from "@/frontend/components/LoadingBloom";
import { ThemeToggle } from "@/frontend/components/ThemeToggle";
import { WalletManageModal, WalletSwitcher } from "@/frontend/components/Wallets";
import {
  AddExpenseModal,
  Icon,
  MobileBottomNav,
  MonthSwitcher,
  Sidebar,
} from "@/frontend/components/ui";
import { CURRENT_MONTH_KEY, MONTHS, TODAY_ISO } from "@/frontend/lib/data";
import { releaseHoldForOccurrence, restoreHoldForOccurrence } from "@/frontend/lib/envelope-holds";
import { ApiError } from "@/frontend/lib/api";
import { useLedger } from "@/frontend/lib/hooks/useLedger";
import { useLedgerTour, type TourKind } from "@/frontend/lib/tour";
import { useWhatsNew } from "@/frontend/lib/whats-new";
import type {
  Account,
  CapitalItem,
  CapitalPlan,
  Category,
  Expense,
  FuelFill,
  LedgerEvent,
  Vehicle,
  ViewId,
} from "@/frontend/lib/types";
import { VEHICLE_TYPES } from "@/frontend/lib/fuelInsights";
import {
  Budgets as BudgetsView,
  Insights,
  Overview,
  Recurring,
  Transactions,
} from "@/frontend/views";
import type { Piggy, Piglet } from "@/frontend/lib/piggies";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";

/* Schedule and its EventModal share one file — deferring both keeps the
   calendar/reminder logic out of the initial bundle for anyone who never
   opens Schedule or adds an event straight from Overview's quick-add. */
const Schedule = lazy(() =>
  import("@/frontend/views/Schedule").then((m) => ({ default: m.Schedule })),
);
const EventModal = lazy(() =>
  import("@/frontend/views/Schedule").then((m) => ({ default: m.EventModal })),
);

/* Own-file views, deferred until first opened — cuts their deps (mermaid, etc) from the initial load. */
const CategoriesView = lazy(() =>
  import("@/frontend/views/Categories").then((m) => ({ default: m.Categories })),
);
const TodoListView = lazy(() =>
  import("@/frontend/views/TodoList").then((m) => ({ default: m.TodoListView })),
);
const Calculator = lazy(() =>
  import("@/frontend/views/Calculator").then((m) => ({ default: m.Calculator })),
);
const Piggies = lazy(() =>
  import("@/frontend/views/Piggies").then((m) => ({ default: m.Piggies })),
);
const Capitals = lazy(() =>
  import("@/frontend/views/Capitals").then((m) => ({ default: m.Capitals })),
);
const Vehicles = lazy(() =>
  import("@/frontend/views/Vehicles").then((m) => ({ default: m.Vehicles })),
);
const Transparency = lazy(() =>
  import("@/frontend/views/Transparency").then((m) => ({ default: m.Transparency })),
);

/*
 * LedgerApp — authenticated app shell
 * ───────────────────────────────────
 * Desktop: sidebar + topbar + scrollable view.
 * Mobile (≤860px): tab bar + More sheet replaces the sidebar.
 * Hosts the global modals (expense, wallet management, event).
 */

type LedgerAppProps = {
  account: Account;
  onSignOut: () => void;
  signingOut?: boolean;
};

const VIEW_TITLES: Record<ViewId, string> = {
  overview: "Overview",
  todos: "TO-DO List",
  schedule: "Schedule",
  transactions: "Transactions",
  budgets: "Budgets",
  calculator: "Calculator",
  categories: "Categories",
  recurring: "Recurring",
  piggies: "Piggies",
  capitals: "Capitals",
  vehicles: "Vehicles",
  insights: "Insights",
  transparency: "Transparency",
};

/** Animated page title; remounts when `view` changes so enter motion replays. */
function PageTitle({ view }: { view: ViewId }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEnter(titleRef, { y: 4 });

  return (
    <h1 ref={titleRef} className="page-title">
      {VIEW_TITLES[view]}
    </h1>
  );
}

export function LedgerApp({ account, onSignOut, signingOut = false }: LedgerAppProps) {
  const ledger = useLedger(account.address);
  const [view, setView] = useState<ViewId>("overview");
  const [modal, setModal] = useState<
    | Expense
    | {
        add: true;
        eventId?: string;
        date?: string;
        note?: string;
        sub?: string;
        kind?: "expense" | "income";
        amount?: number;
        /** Piggy-withdraw mode: locks kind/category/sub and caps the amount. */
        lockedSub?: string;
        maxAmount?: number;
        title?: string;
      }
    | null
  >(null);
  /** Set while the AddExpenseModal is open to log a capital plan item's payment. */
  const [capitalLogTarget, setCapitalLogTarget] = useState<{
    plan: CapitalPlan;
    item: CapitalItem;
  } | null>(null);
  /** Set while the AddExpenseModal is open to log a fuel fill's payment. */
  const [fillLogTarget, setFillLogTarget] = useState<{ vehicle: Vehicle; fill: FuelFill } | null>(
    null,
  );
  const [evModal, setEvModal] = useState<LedgerEvent | { add: true; date: string } | null>(null);
  const [evOccurrenceIso, setEvOccurrenceIso] = useState<string | undefined>(undefined);
  const [walletModal, setWalletModal] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const monthInitialized = useRef(false);
  const fabRef = useRef<HTMLDivElement>(null);
  const tourReady = !ledger.isLoading && !ledger.error && !!ledger.profile;
  const { setTourState, tourPreference, toursSeen } = ledger;
  const {
    isLoading: ledgerIsLoading,
    error: ledgerError,
    profile: ledgerProfile,
    setMonth: syncLedgerMonth,
  } = ledger;

  /* Latched so the modal survives its own exit animation: answering flips
     tourPreference off "pending", which would otherwise unmount it mid-fade. */
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const welcomeDue = tourReady && tourPreference === "pending";

  useEffect(() => {
    if (welcomeDue) setWelcomeOpen(true);
  }, [welcomeDue]);

  /* A 401/403 mid-session (expired cookie, revoked session) used to render
     the same "API is down" screen with no way out but a manual reload —
     route it to sign-out instead so the user lands back on AuthScreen. */
  const authErrorStatus = ledgerError instanceof ApiError ? ledgerError.status : undefined;
  useEffect(() => {
    if (authErrorStatus === 401 || authErrorStatus === 403) onSignOut();
  }, [authErrorStatus, onSignOut]);

  /* Accumulates locally as tours finish. Two tours can end back to back —
     the shell tour hands straight off to the current view's — and reading
     `toursSeen` alone would let the second PATCH overwrite the first before
     it had landed. */
  const seenRef = useRef<string[]>(toursSeen);
  if (toursSeen.length > seenRef.current.length) seenRef.current = toursSeen;

  /** Record a tour as shown for this user, on their profile. */
  const markTourSeen = useCallback(
    (kind: TourKind) => {
      if (seenRef.current.includes(kind)) return;

      seenRef.current = [...seenRef.current, kind];
      void setTourState({ toursSeen: seenRef.current }).catch(() => {
        /* A failed write just means the tour is offered again next visit. */
      });
    },
    [setTourState],
  );

  const { startViewTour } = useLedgerTour({
    view,
    ready: tourReady,
    preference: tourPreference,
    seen: toursSeen,
    onSeen: markTourSeen,
  });

  const {
    open: whatsNewOpen,
    openWhatsNew,
    closeWhatsNew,
  } = useWhatsNew({
    ready: tourReady,
    /* welcomeDue blocks from frame 0 before welcomeOpen latches; welcomeOpen
       keeps the gate closed through the exit animation after the choice. */
    blocked: welcomeOpen || welcomeDue,
  });

  /** Take the guided walkthrough; the shell tour starts once this lands. */
  const chooseGuidedTour = useCallback(
    () => setTourState({ tourPreference: "guided" }),
    [setTourState],
  );

  /** Explore alone: bank every tour as seen so none of them auto-open. */
  const chooseExploreAlone = useCallback(
    () =>
      setTourState({
        tourPreference: "explore",
        toursSeen: ["shell", ...(Object.keys(VIEW_TITLES) as ViewId[])],
      }),
    [setTourState],
  );

  useEffect(() => {
    if (!fabOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFabOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) setFabOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [fabOpen]);

  useEffect(() => {
    if (ledgerIsLoading || ledgerError || monthInitialized.current || !ledgerProfile) return;
    monthInitialized.current = true;
    if (ledgerProfile.currentMonth !== CURRENT_MONTH_KEY) {
      syncLedgerMonth(CURRENT_MONTH_KEY);
    }
  }, [ledgerIsLoading, ledgerError, ledgerProfile, syncLedgerMonth]);

  if (ledger.isLoading) {
    return (
      <div className="app app--loading">
        <LoadingBloom />
      </div>
    );
  }

  if (ledger.error) {
    if (authErrorStatus === 401 || authErrorStatus === 403) {
      /* onSignOut() already fired above; this only covers the brief render
         before Root swaps back to AuthScreen. */
      return (
        <div className="app app--loading">
          <LoadingBloom label="Session expired — signing you out…" />
        </div>
      );
    }

    const message =
      authErrorStatus === 429
        ? "Too many requests. Please wait a moment and reload."
        : authErrorStatus !== undefined && authErrorStatus >= 500
          ? "The server hit an error. Try again in a moment."
          : "Could not reach the server. Check your connection and try again.";

    return (
      <div className="app app--loading">
        <div className="loading-state loading-state--error">{message}</div>
      </div>
    );
  }

  const {
    expenses,
    allExpenses,
    budgets,
    wallet,
    currency,
    events,
    month,
    wallets,
    activeWallet,
    setMonth,
    setBudgets,
    isBudgetsPending,
    isMonthPending,
    isSaving,
    setActiveWalletId,
  } = ledger;

  const saveExpense = async (data: Omit<Expense, "id"> & { id?: string }) => {
    const walletId = data.walletId || activeWallet?.id;
    if (!walletId) return;
    const saved = await ledger.saveExpense({ ...data, walletId });
    if (data.eventId) {
      const ev = events.find((e) => e.id === data.eventId);
      if (ev) {
        try {
          let patch = releaseHoldForOccurrence(ev, data.date);
          if (!data.id && saved?.expense?.id) {
            patch = { ...patch, expenseId: saved.expense.id };
          }
          await ledger.saveEvent(patch);
        } catch {
          /* Link-back / hold release is best-effort; expense already saved. */
        }
      }
    }
    if (capitalLogTarget && saved?.expense) {
      const { plan, item } = capitalLogTarget;
      setCapitalLogTarget(null);
      try {
        const items = plan.items.map((i) =>
          i.id === item.id
            ? {
                ...i,
                paid: true,
                actualCost: saved.expense.amount,
                loggedExpenseId: saved.expense.id,
              }
            : i,
        );
        await ledger.saveCapitalPlan({ id: plan.id, items });
      } catch {
        /* Expense already saved; the plan can be marked paid manually if this fails. */
      }
    }
    if (fillLogTarget && saved?.expense) {
      const { fill } = fillLogTarget;
      setFillLogTarget(null);
      try {
        await ledger.saveVehicleFill({ ...fill, expenseId: saved.expense.id });
      } catch {
        /* Expense already saved; the fill stays unlinked if this fails. */
      }
    }
    setModal(null);
  };

  /** Open the transaction modal prefilled to log a capital plan item's payment. */
  const logCapitalItem = (plan: CapitalPlan, item: CapitalItem) => {
    setCapitalLogTarget({ plan, item });
    setModal({
      add: true,
      kind: "expense",
      note: item.name,
      amount: item.estimatedCost || undefined,
      title: `Log payment: ${item.name}`,
    });
  };

  /** Open the transaction modal prefilled to log a fuel fill's payment. */
  const logFuelFill = (vehicle: Vehicle, fill: FuelFill) => {
    const meta = VEHICLE_TYPES[vehicle.type];
    setFillLogTarget({ vehicle, fill });
    setModal({
      add: true,
      kind: "expense",
      date: fill.date,
      note: `${meta.fillVerb} · ${vehicle.name}`,
      amount: fill.price,
      title: `Log ${meta.fillNoun}: ${vehicle.name}`,
    });
  };

  /** Open expense modal prefilled from a schedule event. */
  const logPaymentFromEvent = (ev: {
    id: string;
    title: string;
    date: string;
    expenseId?: string;
  }) => {
    if (ev.expenseId) {
      const linked = allExpenses.find((e) => e.id === ev.expenseId);
      if (linked) {
        setEvModal(null);
        setModal(linked);
        return;
      }
    }
    setEvModal(null);
    setModal({
      add: true,
      eventId: ev.id,
      date: ev.date,
      note: ev.title,
    });
  };

  const importExpenses = async (rows: Omit<Expense, "id">[], categories?: Category[]) => {
    let newCategories = 0;
    let newSubcategories = 0;
    if (categories) {
      const before = new Set(ledger.categoryIndex.allCategories.map((c) => c.id));
      const beforeSubs = new Set(
        ledger.categoryIndex.allCategories.flatMap((c) => c.subs.map((s) => s.id)),
      );
      await ledger.saveCategories(categories);
      newCategories = categories.filter((c) => !before.has(c.id)).length;
      newSubcategories = categories
        .flatMap((c) => c.subs)
        .filter((s) => !beforeSubs.has(s.id)).length;
    }

    let imported = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const walletId = row.walletId || activeWallet?.id;
        if (!walletId) {
          failed++;
          continue;
        }
        await ledger.saveExpense({ ...row, walletId });
        imported++;
      } catch {
        failed++;
      }
    }
    return { imported, failed, newCategories, newSubcategories };
  };

  const importEvents = async (rows: EventImportRow[]) => {
    let imported = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await ledger.saveEvent(row);
        imported++;
      } catch {
        failed++;
      }
    }
    return { imported, failed };
  };

  const importTodos = async (lists: TodoImportList[]) => {
    let importedLists = 0;
    let importedTasks = 0;
    let failed = 0;

    for (const listData of lists) {
      try {
        const existing =
          (listData.listId && ledger.todoLists.find((l) => l.id === listData.listId)) ||
          ledger.todoLists.find((l) => l.name.toLowerCase() === listData.name.toLowerCase());

        if (existing) {
          const existingIds = new Set(existing.tasks.map((t) => t.id));
          const merged = [...existing.tasks];
          for (const task of listData.tasks) {
            if (existingIds.has(task.id)) continue;
            merged.push(task);
            importedTasks++;
          }
          if (merged.length > existing.tasks.length) {
            await ledger.saveTodoList({ id: existing.id, tasks: merged });
          }
        } else {
          const created = await ledger.saveTodoList({ name: listData.name, icon: listData.icon });
          importedLists++;
          if (listData.tasks.length) {
            await ledger.saveTodoList({ id: created.id, tasks: listData.tasks });
            importedTasks += listData.tasks.length;
          }
        }
      } catch {
        failed++;
      }
    }

    return { importedLists, importedTasks, failed };
  };

  /** Restore an encrypted backup snapshot into the unlocked ledger. */
  const restoreBackup = async (plain: LedgerBackupPlain) => {
    return restoreBackupToLedger(
      plain,
      {
        address: account.address,
        wallets,
        expenses: allExpenses,
        events,
        todoLists: ledger.todoLists,
        capitalPlans: ledger.capitalPlans,
        vehicles: ledger.vehicles,
        vehicleFills: ledger.vehicleFills,
      },
      {
        saveCategories: ledger.saveCategories,
        saveWallet: async (w) => ledger.saveWallet(w),
        saveExpense: async (e) => {
          await ledger.saveExpense(e);
        },
        saveEvent: async (e) => {
          await ledger.saveEvent(e);
        },
        saveTodoList: async (t) => {
          await ledger.saveTodoList(t);
        },
        saveCapitalPlan: async (p) => {
          await ledger.saveCapitalPlan(p);
        },
        saveVehicle: async (v) => ledger.saveVehicle(v),
        saveVehicleFill: async (f) => {
          await ledger.saveVehicleFill(f);
        },
      },
    );
  };

  /**
   * Drop a Capital item's link to an expense that no longer exists.
   *
   * The checkbox stands — deleting the ledger row does not un-pay the venue —
   * but `actualCost` claimed a figure the ledger no longer has, so the item
   * falls back to its estimate (`planPaidTotal` already does that when
   * `actualCost` is unset). The plan is E2EE, so no server cascade can reach it.
   */
  const unlinkCapitalItems = async (deletedIds: string[]) => {
    const gone = new Set(deletedIds);

    for (const plan of ledger.capitalPlans) {
      if (!plan.items.some((i) => i.loggedExpenseId && gone.has(i.loggedExpenseId))) continue;

      const items = plan.items.map((i) => {
        if (!i.loggedExpenseId || !gone.has(i.loggedExpenseId)) return i;
        const { loggedExpenseId: _dropped, actualCost: _stale, ...rest } = i;

        return rest;
      });

      try {
        await ledger.saveCapitalPlan({ id: plan.id, items });
      } catch {
        /* Best-effort: the expense is already deleted. */
      }
    }
  };

  /* A fill whose logged expense was deleted must offer "Log" again. Same
     resolution the event modal does before showing "View Linked Payment". */
  const liveExpenseIds = new Set(allExpenses.map((e) => e.id));

  const deleteExpense = async (
    id: string,
    opts?: { scope?: "this" | "future" | "all"; fromDate?: string },
  ) => {
    /* Snapshot the dates before the delete — the rows are gone afterwards. */
    const datesById = new Map(allExpenses.map((e) => [e.id, e.date]));

    const res = await ledger.deleteExpense(id, opts);
    /* A skipped occurrence is gone from every read path too, so its links are
       dead as well — and the server unlinks it for the same reason. */
    const affected = [...(res?.deletedIds ?? []), ...(res?.skippedId ? [res.skippedId] : [])];
    const deletedIds = affected.length ? affected : [id];

    /*
     * The server clears events.expenseId and vehicleFills.expenseId for every
     * deleted row. Repeating events also track release in
     * `budgetHoldReleasedDates`, which lives inside the encrypted payload, so
     * only the client can restore those — do it for every deleted id, not just
     * the one clicked, or a "delete all" leaves the rest of the series' holds
     * released forever. An event outside the month currently loaded is still
     * missed; the server-side unlink covers the once-event case, which is the
     * only one `isHoldReleased` reads expenseId for.
     */
    for (const deletedId of deletedIds) {
      const linkedEvent = events.find((ev) => ev.expenseId === deletedId);
      if (!linkedEvent) continue;
      const occurrenceIso = datesById.get(deletedId) ?? linkedEvent.date;
      try {
        await ledger.saveEvent(restoreHoldForOccurrence(linkedEvent, occurrenceIso));
      } catch {
        /* Best-effort: the expense is already deleted. */
      }
    }

    await unlinkCapitalItems(deletedIds);

    setModal(null);
  };

  const saveEvent = async (data: LedgerEvent & { id?: string }) => {
    await ledger.saveEvent(data);
    setEvModal(null);
    setEvOccurrenceIso(undefined);
  };

  const deleteEvent = async (
    id: string,
    opts?: { scope?: "this" | "future" | "all"; fromDate?: string },
  ) => {
    await ledger.deleteEvent(id, opts);
    setEvModal(null);
    setEvOccurrenceIso(undefined);
  };

  /** Open an event for edit with the calendar occurrence under the cursor. */
  const openEvent = (ev: LedgerEvent, occurrenceIso?: string) => {
    setEvOccurrenceIso(occurrenceIso ?? ev.date);
    setEvModal(ev);
  };

  /** Open the transaction modal prefilled to deposit into a piggy's subcategory. */
  const addPiggyDeposit = (_piggy: Piggy, sub: Piglet) => {
    setModal({ add: true, kind: "expense", sub: sub.subId });
  };

  /** Open the transaction modal locked to withdraw from a piggy's subcategory. */
  const withdrawFromPiggy = (piggy: Piggy, sub: Piglet) => {
    setModal({
      add: true,
      kind: "income",
      sub: sub.subId,
      lockedSub: sub.subId,
      maxAmount: piggy.balance,
      title: `Withdraw from ${piggy.name}`,
    });
  };

  const viewProps = {
    expenses,
    budgets,
    wallet,
    month,
    currency,
    categoryIndex: ledger.categoryIndex,
  };

  return (
    <div className="app">
      <Sidebar view={view} setView={setView} />
      <main className="main">
        <header className="topbar">
          <div className="tb-row tb-row--main">
            <div className="page-title-row">
              <PageTitle key={view} view={view} />
              <button
                type="button"
                className="tour-help-btn"
                aria-label={`Tour ${VIEW_TITLES[view]}`}
                onClick={() => startViewTour(view)}
              >
                <Icon name="info" size={17} />
              </button>
            </div>
            <div className="tb-actions">
              <ThemeToggle />
              <AccountMenu
                account={account}
                onSignOut={onSignOut}
                signingOut={signingOut}
                expenses={allExpenses}
                events={events}
                todoLists={ledger.todoLists}
                wallets={wallets}
                categoryIndex={ledger.categoryIndex}
                activeWalletId={activeWallet?.id}
                savingsTxns={ledger.savingsTxns}
                capitalPlans={ledger.capitalPlans}
                vehicles={ledger.vehicles}
                vehicleFills={ledger.vehicleFills}
                onImportExpenses={importExpenses}
                onImportEvents={importEvents}
                onImportTodos={importTodos}
                onRestoreBackup={restoreBackup}
                onTakeTour={() => startViewTour(view)}
                onWhatsNew={openWhatsNew}
              />
            </div>
          </div>
          {view !== "transparency" ? (
            <div className="tb-row tb-row--tools">
              {activeWallet && wallets.length ? (
                <WalletSwitcher
                  wallets={wallets}
                  activeId={activeWallet.id}
                  onChange={setActiveWalletId}
                  onManage={() => setWalletModal(true)}
                />
              ) : null}
              <MonthSwitcher
                months={MONTHS}
                current={month}
                onChange={setMonth}
                changing={isMonthPending}
              />
            </div>
          ) : null}
        </header>

        <div className="scroll">
          <Suspense
            fallback={
              <div className="view-loading">
                <LoadingBloom />
              </div>
            }
          >
            {view === "overview" && (
              <Overview
                {...viewProps}
                balanceExpenses={ledger.balanceExpenses}
                todoLists={ledger.todoLists}
                events={events}
                savingsTxns={ledger.savingsTxns}
                setView={setView}
                onEdit={setModal}
                onEditEvent={(ev: LedgerEvent) => openEvent(ev, TODAY_ISO)}
              />
            )}
            {view === "schedule" && (
              <Schedule
                events={events}
                month={month}
                currency={currency}
                onAddEvent={(iso: string) => {
                  setEvOccurrenceIso(undefined);
                  setEvModal({ add: true, date: iso });
                }}
                onEditEvent={openEvent}
              />
            )}
            {view === "todos" && (
              <TodoListView
                todoLists={ledger.todoLists}
                onSave={ledger.saveTodoList}
                onDelete={ledger.deleteTodoList}
              />
            )}
            {view === "transactions" && (
              <Transactions {...viewProps} onEdit={setModal} onDelete={deleteExpense} />
            )}
            {view === "budgets" && (
              <BudgetsView
                {...viewProps}
                events={events}
                setBudgets={setBudgets}
                budgetsSaving={isBudgetsPending}
                setView={setView}
              />
            )}
            {view === "calculator" && (
              <Calculator
                wallet={wallet}
                budgets={budgets}
                setBudgets={setBudgets}
                budgetsSaving={isBudgetsPending}
                currency={currency}
                categoryIndex={ledger.categoryIndex}
              />
            )}
            {view === "categories" && (
              <CategoriesView
                categoryIndex={ledger.categoryIndex}
                onSave={ledger.saveCategories}
                usedSubIds={ledger.usedSubIds}
                expenses={ledger.usedSubIds === null ? null : ledger.allExpenses}
                onTransfer={ledger.transferHistory}
              />
            )}
            {view === "recurring" && <Recurring {...viewProps} onEdit={setModal} />}
            {view === "piggies" && (
              <Piggies
                savingsTxns={ledger.savingsTxns}
                savingsLoading={ledger.savingsLoading}
                allExpenses={allExpenses}
                categoryIndex={ledger.categoryIndex}
                currency={currency}
                month={month}
                onAddDeposit={addPiggyDeposit}
                onWithdraw={withdrawFromPiggy}
              />
            )}
            {view === "capitals" && (
              <Capitals
                capitalPlans={ledger.capitalPlans}
                savingsTxns={ledger.savingsTxns}
                categoryIndex={ledger.categoryIndex}
                currency={currency}
                onSavePlan={ledger.saveCapitalPlan}
                onDeletePlan={ledger.deleteCapitalPlan}
                onLogItem={logCapitalItem}
              />
            )}
            {view === "vehicles" && (
              <Vehicles
                vehicles={ledger.vehicles}
                fills={ledger.vehicleFills}
                fillsLoading={ledger.vehicleFillsLoading}
                currency={currency}
                onSaveVehicle={ledger.saveVehicle}
                onDeleteVehicle={ledger.deleteVehicle}
                onSaveFill={ledger.saveVehicleFill}
                onDeleteFill={ledger.deleteVehicleFill}
                onLogFill={logFuelFill}
                linkedExpenseIds={liveExpenseIds}
              />
            )}
            {view === "insights" && (
              <Insights {...viewProps} capitalPlans={ledger.capitalPlans} setMonth={setMonth} />
            )}
            {view === "transparency" && <Transparency />}
            <div className="scroll-pad" />
          </Suspense>
        </div>
      </main>

      <MobileBottomNav view={view} setView={setView} />

      <div
        ref={fabRef}
        data-tour="tour-fab"
        className={
          "fab-wrap" +
          (fabOpen ? " open" : "") +
          (view === "transparency" ? " fab-wrap--hidden" : "")
        }
      >
        <div className="fab-actions" aria-hidden={!fabOpen}>
          <button
            className="fab-action"
            type="button"
            aria-label="Add Event"
            tabIndex={fabOpen ? 0 : -1}
            disabled={isSaving}
            onClick={() => {
              setFabOpen(false);
              setEvModal({ add: true, date: TODAY_ISO });
            }}
          >
            <Icon name="calendar" size={20} />
            <span className="fab-action-label">Event</span>
          </button>
          <button
            className="fab-action"
            type="button"
            aria-label="Add Transaction"
            tabIndex={fabOpen ? 0 : -1}
            disabled={isSaving}
            onClick={() => {
              setFabOpen(false);
              setModal({ add: true });
            }}
          >
            <Icon name="list" size={20} />
            <span className="fab-action-label">Transaction</span>
          </button>
        </div>
        {/* A write is in flight somewhere in the app: opening a second editor
            on top of it invites a duplicate submit, so hold the quick-add. */}
        <button
          className="fab"
          type="button"
          aria-label={fabOpen ? "Close Add Menu" : "Open Add Menu"}
          aria-expanded={fabOpen}
          disabled={isSaving}
          onClick={() => setFabOpen((o) => !o)}
        >
          <Icon name="chevU" size={26} />
        </button>
      </div>

      {modal && activeWallet ? (
        <AddExpenseModal
          initial={
            "add" in modal
              ? modal.eventId || modal.date || modal.note || modal.sub || modal.kind || modal.amount
                ? {
                    eventId: modal.eventId,
                    date: modal.date,
                    note: modal.note,
                    sub: modal.sub,
                    kind: modal.kind,
                    amount: modal.amount,
                  }
                : null
              : modal
          }
          wallets={wallets}
          defaultWalletId={activeWallet.id}
          categoryIndex={ledger.categoryIndex}
          capitalPlans={ledger.capitalPlans}
          onSave={saveExpense}
          onClose={() => {
            setCapitalLogTarget(null);
            setFillLogTarget(null);
            setModal(null);
          }}
          onDelete={deleteExpense}
          title={"add" in modal ? modal.title : undefined}
          lockedSub={"add" in modal ? modal.lockedSub : undefined}
          maxAmount={"add" in modal ? modal.maxAmount : undefined}
        />
      ) : null}
      {walletModal ? (
        <WalletManageModal
          wallets={wallets}
          activeId={activeWallet?.id ?? ""}
          onSave={ledger.saveWallet}
          onDelete={ledger.deleteWallet}
          onClose={() => setWalletModal(false)}
        />
      ) : null}
      {evModal && (
        <Suspense fallback={null}>
          <EventModal
            initial={"add" in evModal ? null : evModal}
            defaultDate={"add" in evModal ? evModal.date : undefined}
            occurrenceIso={"add" in evModal ? undefined : evOccurrenceIso}
            hasLinkedPayment={
              !("add" in evModal) &&
              !!evModal.expenseId &&
              allExpenses.some((expense) => expense.id === evModal.expenseId)
            }
            categoryIndex={ledger.categoryIndex}
            currency={currency}
            onSave={saveEvent}
            onLogPayment={logPaymentFromEvent}
            onClose={() => {
              setEvModal(null);
              setEvOccurrenceIso(undefined);
            }}
            onDelete={deleteEvent}
          />
        </Suspense>
      )}
      {welcomeOpen ? (
        <TourWelcomeModal
          onGuided={chooseGuidedTour}
          onExplore={chooseExploreAlone}
          onClosed={() => setWelcomeOpen(false)}
        />
      ) : null}
      {whatsNewOpen ? <WhatsNewModal onClose={closeWhatsNew} /> : null}
    </div>
  );
}
