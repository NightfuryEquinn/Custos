import { useEnter, useModalMotion, useStagger } from "@/frontend/lib/animate";
import { FadeIn } from "@/frontend/components/FadeIn";
import { AreaTrend, Donut, MiniSpark, MoMBars } from "@/frontend/charts";
import { CapitalPaceList } from "@/frontend/components/CapitalPaceList";
import { CurrencyPicker } from "@/frontend/components/CurrencyPicker";
import {
  CatGlyph,
  EmptyState,
  Icon,
  Segmented,
  SummaryCard,
  TransactionRow,
  glyphTint,
} from "@/frontend/components/ui";
import {
  isSavingsCategory,
  isSpendingCategory,
  spendingCategoriesFor,
} from "@/frontend/lib/categories";
import { buildPiggies } from "@/frontend/lib/piggies";
import { computeSavingsInsights } from "@/frontend/lib/savingsInsights";
import {
  CURRENT_DAY,
  CURRENT_MONTH_KEY,
  MONTHS,
  dayLabel,
  eventCatMeta,
  eventTimeLabel,
  eventDaysForDay,
  fmtBudgetLimit,
  fmtMoney,
  getCurrency,
  isBudgetSet,
  monthLabel,
  monthsWindow,
  pad,
  roundMoney,
  weekdayLabel,
} from "@/frontend/lib/data";
import { fetchFxRates, fxConvert } from "@/frontend/lib/fx";
import { evaluateExpression, isPlainNumber } from "@/frontend/lib/arithmetic";
import {
  INCOME_MIN_EVENTS,
  INCOME_MIN_MONTHS,
  assessIncomeProfile,
  buildIncomeNarrative,
  declaresMonthlyIncome,
  type IncomeWindow,
} from "@/frontend/lib/incomeProfile";
import {
  assessSpendingHabit,
  buildHabitNarrative,
  describeHabitShift,
  habitTrajectory,
  type HabitPeriod,
} from "@/frontend/lib/spendingHabits";
import {
  catOf,
  chartActiveKey,
  chartBudgetForPeriod,
  chartSelectionMonth,
  classifyTx,
  dayFlowSeries,
  isIncome,
  isOutgoing,
  isSavings,
  monthExpenses,
  monthStats,
  recurringDueDay,
  recurringLabel,
  recurringMonthlyEquivalent,
  recurringScheduleKey,
  recurringSchedulesForMonth,
  sortExpensesByDateDesc,
  spendingChartSeries,
  type ChartPeriod,
  type WalletFunding,
} from "@/frontend/lib/stats";
import { useTheme } from "@/frontend/lib/hooks/useTheme";
import type {
  Budgets,
  CapitalPlan,
  CategoryIndex,
  Expense,
  FinancialWallet,
  LedgerEvent,
  TodoList,
  ViewId,
} from "@/frontend/lib/types";
import { displayGlyph } from "@/lib/glyphs";
import type { DeleteScope } from "@/lib/delete-scope";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/*
 * Ledger views
 * ────────────
 *   Overview     — summary cards, to-do & schedule, spend/earn trend, donut,
 *                  recent transactions
 *   Transactions — searchable / filterable list grouped by date
 *   Budgets      — per-category budget editing
 *   Insights     — month-over-month and category trends
 *   Recurring    — fixed monthly commitments
 */

/** Trailing window Saving Insights reads on the Insights view. */
const SAVINGS_WINDOW_MONTHS = 12;

/** Every list (main category) that still has at least one incomplete task. */
function pendingTodoLists(todoLists: TodoList[]) {
  return todoLists.filter((list) => list.tasks.some((t) => !t.done));
}

/** ISO date YYYY-MM-DD for a Date. */
function isoDateOf(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Every event covering today, earliest first. */
function todaysEvents(events: LedgerEvent[], now: Date) {
  return eventDaysForDay(events, isoDateOf(now));
}

/** Used wherever a wallet is legitimately absent (still loading, no wallet selected). */
const EMPTY_WALLET: WalletFunding = { fundingMode: "starting", income: 0, startingBalance: 0 };

const MOBILE_MQ = "(max-width: 860px)";

/** Track whether the viewport matches the tablet/mobile breakpoint. */
function useIsMobile() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_MQ).matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    /** Sync React state when the media query flips. */
    const onChange = () => setMobile(mq.matches);

    onChange();
    mq.addEventListener("change", onChange);

    return () => mq.removeEventListener("change", onChange);
  }, []);

  return mobile;
}

type OverviewProps = {
  expenses: Expense[];
  budgets: Budgets;
  wallet: FinancialWallet | null | undefined;
  month: string;
  currency: string;
  categoryIndex: CategoryIndex;
  todoLists?: TodoList[];
  events?: LedgerEvent[];
  setView: (view: ViewId) => void;
  onEdit: (expense: Expense) => void;
  onEditEvent: (event: LedgerEvent) => void;
  balanceExpenses?: Expense[];
};

// ── Overview ────────────────────────────────────────────────────────
/** Home summary: trend, today's transactions and schedule, and pending to-do lists. */
export function Overview({
  expenses,
  budgets,
  wallet,
  month,
  currency,
  categoryIndex,
  todoLists = [],
  events = [],
  balanceExpenses,
  setView,
  onEdit,
  onEditEvent,
}: OverviewProps) {
  const [loadedAt] = useState(() => new Date());
  const st = useMemo(
    () =>
      monthStats(expenses, budgets, wallet ?? EMPTY_WALLET, month, categoryIndex, undefined, {
        balanceExpenses,
      }),
    [expenses, budgets, wallet, month, categoryIndex, balanceExpenses],
  );
  const [hoverCat, setHoverCat] = useState<string | null>(null);
  const [expandedCat, setExpandedCat] = useState<Record<string, boolean>>({});
  const isMobile = useIsMobile();
  const donutSize = isMobile ? 168 : 188;
  const donutThickness = isMobile ? 24 : 26;
  const pendingTodos = useMemo(() => pendingTodoLists(todoLists), [todoLists]);
  const todayEvents = useMemo(() => todaysEvents(events, loadedAt), [events, loadedAt]);

  const donutData = useMemo(
    () =>
      spendingCategoriesFor(categoryIndex, (id) => (st.byCat[id] || 0) > 0)
        .map((c) => ({
          id: c.id,
          label: c.name,
          value: st.byCat[c.id] || 0,
          color: c.color,
          glyph: displayGlyph(c.glyph, c.id),
        }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value),
    [categoryIndex, st.byCat],
  );
  const totalAll = useMemo(() => donutData.reduce((s, d) => s + d.value, 0), [donutData]);

  const [yy, mm] = month.split("-").map(Number);
  const days = new Date(yy ?? 0, mm ?? 0, 0).getDate();
  const todayCap = month === CURRENT_MONTH_KEY ? CURRENT_DAY : days;
  /** Per-day spend / income split by source — powers the trend hover card. */
  const dayFlows = useMemo(
    () => dayFlowSeries(st.list, month, categoryIndex, todayCap),
    [st.list, month, categoryIndex, todayCap],
  );
  const trendDetails = useMemo(
    () => dayFlows.map((f) => ({ ...f, label: `${weekdayLabel(f.day)}, ${dayLabel(f.day)}` })),
    [dayFlows],
  );
  /** Cumulative spend and earnings per day of the selected month. */
  const { cum, earnCum } = useMemo(() => {
    const spentPoints: Array<{ x: string; v: number }> = [];
    const earnedPoints: Array<{ x: string; v: number }> = [];
    let spentRun = 0;
    let earnedRun = 0;
    for (const flow of dayFlows) {
      spentRun += flow.spent;
      earnedRun += flow.earned;
      spentPoints.push({ x: flow.label, v: Math.round(spentRun) });
      earnedPoints.push({ x: flow.label, v: Math.round(earnedRun) });
    }
    return { cum: spentPoints, earnCum: earnedPoints };
  }, [dayFlows]);
  /** The trend line's own running total includes savings deposits (it
   *  mirrors the chart's budget line, which counts the savings envelope) —
   *  pull that back out so the Spending figure doesn't double up with the
   *  Saved figure next to it. */
  const trendSpent = (cum.length ? cum[cum.length - 1]!.v : 0) - st.saved;

  const todayIso = isoDateOf(loadedAt);
  const recent = st.list.filter((e) => e.date === todayIso);
  const { accent } = useTheme();
  const activeCat = hoverCat;
  const viewRef = useRef<HTMLDivElement>(null);
  useEnter(viewRef);

  return (
    <div ref={viewRef} className="view">
      <section className="panel trend-panel" data-tour="tour-overview-trend">
        <div className="trend-stats">
          <div className="trend-total">
            <span className="trend-key">
              <i className="trend-dot" style={{ background: accent }} /> Spending
            </span>
            <span className="trend-now">{fmtMoney(trendSpent, { currency })}</span>
          </div>
          <div className="trend-total">
            <span className="trend-key">
              <i className="trend-dot trend-dot--earn" /> Earning
            </span>
            <span className="trend-now trend-now--earn">{fmtMoney(st.earned, { currency })}</span>
          </div>
          <div className="trend-total">
            <span className="trend-key">
              <i className="trend-dot trend-dot--saved" /> Saved
            </span>
            <span className="trend-now trend-now--saved">{fmtMoney(st.saved, { currency })}</span>
          </div>
          <div className="trend-total">
            <span className="trend-key">
              <i
                className={
                  "trend-dot" + (st.remaining < 0 ? " trend-dot--danger" : " trend-dot--ok")
                }
              />
              Remaining
            </span>
            <span
              className={"trend-now" + (st.remaining < 0 ? " trend-now--danger" : " trend-now--ok")}
            >
              {fmtMoney(st.remaining, { currency })}
            </span>
          </div>
        </div>
        <AreaTrend
          points={cum.length ? cum : [{ x: "1", v: 0 }]}
          compare={earnCum.length ? earnCum : [{ x: "1", v: 0 }]}
          accent={accent}
          height={210}
          budgetLine={st.totalBudget}
          details={trendDetails.length ? trendDetails : null}
          format={(n) => fmtMoney(n, { currency })}
        />
      </section>

      <section className="panel donut-panel" data-tour="tour-overview-donut">
        <div className="panel-head">
          <h2>By Category</h2>
        </div>
        <div className="donut-wrap">
          <div className="donut-stage">
            <Donut
              data={donutData}
              size={donutSize}
              thickness={donutThickness}
              onHover={setHoverCat}
              activeId={activeCat}
            />
            <div className="donut-center">
              <div className="dc-label">
                {activeCat ? (categoryIndex.catById[activeCat]?.name ?? "Total") : "Total"}
              </div>
              <div className="dc-value">
                {fmtMoney(activeCat ? st.byCat[activeCat] || 0 : totalAll, { currency })}
              </div>
            </div>
          </div>
          {donutData.length ? (
            <ul className="legend">
              {donutData.map((d) => {
                const open = expandedCat[d.id] ?? false;
                const subs = categoryIndex.catById[d.id]?.subs ?? [];
                const subRows = subs
                  .map((s) => ({ ...s, value: st.bySub[s.id] || 0 }))
                  .filter((s) => s.value > 0)
                  .sort((a, b) => b.value - a.value);

                return (
                  <li
                    key={d.id}
                    className={"legend-block" + (activeCat && activeCat !== d.id ? " dim" : "")}
                  >
                    <button
                      type="button"
                      className="legend-row"
                      aria-expanded={subRows.length ? open : undefined}
                      aria-label={
                        subRows.length
                          ? `${open ? "Collapse" : "Expand"} ${d.label} subcategories`
                          : d.label
                      }
                      onClick={() => {
                        if (!subRows.length) return;
                        setExpandedCat((e) => ({ ...e, [d.id]: !open }));
                      }}
                      onMouseEnter={() => setHoverCat(d.id)}
                      onMouseLeave={() => setHoverCat(null)}
                      onTouchStart={() => setHoverCat(d.id)}
                    >
                      <span className="legend-expand">
                        {subRows.length ? <Icon name="chevD" size={14} /> : null}
                      </span>
                      <span className="lg-swatch">{d.glyph}</span>
                      <span className="lg-name">{d.label}</span>
                      <span className="lg-amt">{fmtMoney(d.value, { currency })}</span>
                    </button>
                    {subRows.length ? (
                      <div className={"legend-sub-reveal" + (open ? "" : " is-collapsed")}>
                        <ul className="legend-sub-list">
                          {subRows.map((s) => (
                            <li key={s.id}>
                              <span className="lg-name">{s.name}</span>
                              <span className="lg-amt lg-sub-amt">
                                {fmtMoney(s.value, { currency })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No Spending Yet" sub="Categories fill in as you log transactions." />
          )}
        </div>
      </section>

      <section className="panel" data-tour="tour-overview-recent">
        <div className="panel-head panel-head--row">
          <h2>Recent Transaction</h2>
          <button className="link-btn" onClick={() => setView("transactions")}>
            View More
          </button>
        </div>
        <div className="recent-list">
          {recent.length ? (
            recent.map((e) => {
              const cat = categoryIndex.catById[catOf(e.sub, categoryIndex)];
              if (!cat) return null;

              return (
                <button key={e.id} className="recent-row" onClick={() => onEdit(e)}>
                  <span className="rr-glyph" style={glyphTint(cat.color)}>
                    {displayGlyph(cat.glyph, cat.id)}
                  </span>
                  <span className="rr-main">
                    <span className="rr-note">{e.note}</span>
                    <span className="rr-sub">
                      {categoryIndex.subById[e.sub]?.name ?? e.sub} · {dayLabel(e.date)}
                    </span>
                  </span>
                  <span className={"rr-amt" + (isIncome(e) ? " income" : " expense")}>
                    {isIncome(e) ? "+" : "−"}
                    {fmtMoney(e.amount, { currency })}
                  </span>
                </button>
              );
            })
          ) : (
            <EmptyState title="No Transactions Today" sub="Add one to see it here." />
          )}
        </div>
      </section>

      <section className="panel" data-tour="tour-overview-today-schedule">
        <div className="panel-head panel-head--row">
          <h2>Recent Schedule</h2>
          <button className="link-btn" onClick={() => setView("schedule")}>
            View More
          </button>
        </div>
        <div className="recent-list">
          {todayEvents.length ? (
            todayEvents.map((day) => {
              const ev = day.ev;
              /* eventCatMeta always resolves to a real entry (EVENT_CAT_BY_ID.custom is
               * always present) — noUncheckedIndexedAccess just can't see that, so fall
               * back to the same "custom" meta it would already have picked. */
              const cat = eventCatMeta(ev) ?? {
                id: "custom",
                name: "Custom",
                color: "#8a7355",
                glyph: "✨",
              };

              return (
                <button
                  key={ev.id}
                  type="button"
                  className="recent-row"
                  onClick={() => (onEditEvent ? onEditEvent(ev) : setView("schedule"))}
                >
                  <span className="rr-glyph" style={glyphTint(cat.color)}>
                    {displayGlyph(cat.glyph, cat.id)}
                  </span>
                  <span className="rr-main">
                    <span className="rr-note">{ev.title}</span>
                    <span className="rr-sub">
                      {cat.name} · {eventTimeLabel(ev, day)}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <EmptyState title="Nothing Today" sub="No events scheduled for today." />
          )}
        </div>
      </section>

      <section className="panel" data-tour="tour-overview-oldest-todo">
        <div className="panel-head panel-head--row">
          <h2>Pending To-Dos</h2>
          <button className="link-btn" onClick={() => setView("todos")}>
            View More
          </button>
        </div>
        <div className="recent-list">
          {pendingTodos.length ? (
            pendingTodos.map((list) => {
              const done = list.tasks.filter((t) => t.done).length;
              const total = list.tasks.length;

              return (
                <button
                  key={list.id}
                  type="button"
                  className="recent-row"
                  onClick={() => setView("todos")}
                >
                  <span className="rr-glyph" style={{ background: "var(--surface-3)" }}>
                    {list.icon}
                  </span>
                  <span className="rr-main">
                    <span className="rr-note">{list.name}</span>
                    <span className="rr-sub">
                      {total ? `${done}/${total} done` : "No Tasks Yet"}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <EmptyState title="Nothing Pending" sub="Every list is done, or create a new one." />
          )}
        </div>
      </section>
    </div>
  );
}

type TransactionsProps = {
  expenses: Expense[];
  month: string;
  currency: string;
  categoryIndex: CategoryIndex;
  onEdit: (expense: Expense) => void;
  onDelete: (id: string, opts?: { scope?: DeleteScope; fromDate?: string }) => void | Promise<void>;
};

type FilterOption = { id: string; label: string; glyph?: string; catId?: string };

/** Multi-select dropdown for the Transactions category/subcategory filters. */
function MultiFilterDropdown({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "picker", active: open });

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const triggerLabel =
    selected.size === 0
      ? `All ${label}`
      : selected.size === 1
        ? (options.find((o) => selected.has(o.id))?.label ?? `1 ${label}`)
        : `${selected.size} ${label}`;

  const menu = open
    ? createPortal(
        <div
          ref={scrimRef}
          className="picker-scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) requestClose(() => setOpen(false));
          }}
        >
          <div
            ref={panelRef}
            className="picker-menu picker-menu--category"
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
          >
            <div className="picker-category-list">
              {options.map((o) => {
                const active = selected.has(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={"picker-category-item" + (active ? " active" : "")}
                    onClick={() => onToggle(o.id)}
                  >
                    {o.glyph ? <CatGlyph glyph={o.glyph} id={o.catId ?? o.id} /> : null}
                    <span className="pci-label">{o.label}</span>
                    {active ? <Icon name="check" size={14} /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="picker-wrap txn-filter-wrap">
      <button
        type="button"
        className="picker-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="picker-trigger-label">{triggerLabel}</span>
        <Icon name="chevD" size={16} />
      </button>
      {menu}
    </div>
  );
}

// ── Transactions ────────────────────────────────────────────────────
export function Transactions({
  expenses,
  month,
  currency,
  categoryIndex,
  onEdit,
  onDelete,
}: TransactionsProps) {
  const [q, setQ] = useState("");
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [selectedSubs, setSelectedSubs] = useState<Set<string>>(new Set());

  const { dates, groups } = useMemo(() => {
    let rows = monthExpenses(expenses, month);
    if (selectedCats.size) {
      rows = rows.filter((e) =>
        selectedCats.has(isIncome(e) ? "income" : catOf(e.sub, categoryIndex)),
      );
    }
    if (selectedSubs.size) rows = rows.filter((e) => selectedSubs.has(e.sub));
    if (q.trim()) {
      const s = q.toLowerCase();
      rows = rows.filter(
        (e) =>
          e.note.toLowerCase().includes(s) ||
          (categoryIndex.subById[e.sub]?.name ?? "").toLowerCase().includes(s) ||
          (categoryIndex.catById[catOf(e.sub, categoryIndex)]?.name ?? "")
            .toLowerCase()
            .includes(s),
      );
    }
    const subRows = sortExpensesByDateDesc(rows);
    const byDate: Record<string, typeof subRows> = {};
    subRows.forEach((e) => {
      (byDate[e.date] = byDate[e.date] || []).push(e);
    });
    const sortedDates = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1));

    return { dates: sortedDates, groups: byDate };
  }, [expenses, month, selectedCats, selectedSubs, q, categoryIndex]);

  const sortedCats = useMemo(
    () =>
      [...categoryIndex.categories].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [categoryIndex.categories],
  );

  const categoryOptions = useMemo<FilterOption[]>(
    () =>
      sortedCats.map((c) => ({
        id: c.type === "income" ? "income" : c.id,
        label: c.name,
        glyph: c.glyph,
        catId: c.id,
      })),
    [sortedCats],
  );

  /** Subs of only the selected categories — empty (and the dropdown hidden) until one is picked. */
  const subOptions = useMemo<FilterOption[]>(
    () =>
      selectedCats.size
        ? sortedCats
            .filter((c) => selectedCats.has(c.type === "income" ? "income" : c.id))
            .flatMap((c) => c.subs.map((s) => ({ id: s.id, label: s.name })))
        : [],
    [sortedCats, selectedCats],
  );

  /* A sub stays selected only while its parent category is — deselecting the
     category should drop its subs from the filter too, not leave them
     silently still narrowing the list. */
  useEffect(() => {
    setSelectedSubs((prev) => {
      if (!prev.size) return prev;
      const validIds = new Set(subOptions.map((o) => o.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [subOptions]);

  const toggleCat = (id: string) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSub = (id: string) => {
    setSelectedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearFilters = () => {
    setSelectedCats(new Set());
    setSelectedSubs(new Set());
  };

  const viewRef = useRef<HTMLDivElement>(null);
  const filterPanelRef = useRef<HTMLElement>(null);
  useEnter(viewRef);
  useEnter(filterPanelRef);

  return (
    <div ref={viewRef} className="view">
      <div className="txn-toolbar" data-tour="tour-txn-toolbar">
        <div className="search">
          <Icon name="search" size={17} />
          <input
            placeholder="Search notes & categories"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <div className="txn-filters" data-tour="tour-txn-filters">
        <MultiFilterDropdown
          label="Categories"
          options={categoryOptions}
          selected={selectedCats}
          onToggle={toggleCat}
        />
        {selectedCats.size > 0 ? (
          <MultiFilterDropdown
            label="Subcategories"
            options={subOptions}
            selected={selectedSubs}
            onToggle={toggleSub}
          />
        ) : null}
        {selectedCats.size > 0 || selectedSubs.size > 0 ? (
          <button
            type="button"
            className="txn-filter-clear"
            aria-label="Clear filters"
            onClick={clearFilters}
          >
            <Icon name="close" size={14} />
          </button>
        ) : null}
      </div>

      <section
        key={[...selectedCats].join(",") + ":" + [...selectedSubs].join(",") + ":" + q}
        ref={filterPanelRef}
        className="panel txn-panel txn-panel--filter"
        data-tour="tour-txn-list"
      >
        {dates.length ? (
          dates.map((d) => {
            // `dates` is Object.keys(groups), so this is always populated — the
            // fallback only appeases noUncheckedIndexedAccess.
            const dayRows = groups[d] ?? [];

            return (
              <div key={d} className="txn-group">
                <div className="txn-group-head">
                  <div className="txn-date">
                    <div className="txn-day">{new Date(d + "T00:00:00").getDate()}</div>
                    <div className="txn-wd">{weekdayLabel(d)}</div>
                  </div>
                  <span className="txn-group-total">
                    {(() => {
                      const dayNet = dayRows.reduce(
                        (s, e) => s + (isIncome(e) ? e.amount : -e.amount),
                        0,
                      );
                      return (dayNet >= 0 ? "+" : "−") + fmtMoney(Math.abs(dayNet), { currency });
                    })()}
                  </span>
                </div>
                {dayRows.map((e) => (
                  <TransactionRow
                    key={e.id}
                    exp={e}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    currency={currency}
                    walletName={undefined}
                    categoryIndex={categoryIndex}
                  />
                ))}
              </div>
            );
          })
        ) : (
          <EmptyState title="Nothing Matches" sub="Try a different search or filter." />
        )}
      </section>
    </div>
  );
}

type BudgetsProps = {
  expenses: Expense[];
  budgets: Budgets;
  setBudgets: (budgets: Budgets) => void;
  budgetsSaving?: boolean;
  wallet: FinancialWallet | null | undefined;
  month: string;
  currency: string;
  categoryIndex: CategoryIndex;
  events?: LedgerEvent[];
  setView?: (view: ViewId) => void;
};

// ── Budgets ─────────────────────────────────────────────────────────
export function Budgets({
  expenses,
  budgets,
  setBudgets,
  budgetsSaving = false,
  wallet,
  month,
  currency,
  categoryIndex,
  events = [],
  setView,
}: BudgetsProps) {
  const st = useMemo(
    () => monthStats(expenses, budgets, wallet ?? EMPTY_WALLET, month, categoryIndex, events),
    [expenses, budgets, wallet, month, categoryIndex, events],
  );
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const draftEvaluated = useMemo(() => evaluateExpression(draft), [draft]);
  const draftIsExpression = draftEvaluated !== null && !isPlainNumber(draft);
  const totalBudget = st.totalBudget;
  const totalSpent = st.spent;
  const totalHeld = st.totalHeld;
  const totalAvailable = totalBudget - totalSpent - (st.saved - st.withdrawn) - totalHeld;

  /** Open the inline budget editor for a category. */
  const startEdit = (id: string) => {
    setEditId(id);
    setDraft(isBudgetSet(budgets[id]) ? String(budgets[id]) : "");
  };
  /** Commit the drafted budget amount for the category being edited. */
  const commit = () => {
    const id = editId;
    if (!id || budgetsSaving) return;

    setEditId(null);
    const v = Math.max(0, roundMoney(draftEvaluated ?? 0));
    setBudgets({ ...budgets, [id]: v });
  };
  const viewRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useEnter(viewRef);
  useStagger(gridRef, ".summary-card");

  return (
    <div ref={viewRef} className="view">
      <div ref={gridRef} className="summary-grid sg-5" data-tour="tour-budgets-summary">
        <SummaryCard label="Total Budget" value={fmtMoney(totalBudget, { currency })} />
        <SummaryCard label="Spent so Far" tone="spent" value={fmtMoney(totalSpent, { currency })} />
        <SummaryCard label="Saved" tone="saved" value={fmtMoney(st.saved, { currency })} />
        <SummaryCard label="Reserved" tone="saved" value={fmtMoney(totalHeld, { currency })} />
        <SummaryCard
          label="Available"
          tone={totalAvailable < 0 ? "danger" : "ok"}
          value={fmtMoney(totalAvailable, { currency })}
        />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Budget by Category</h2>
        </div>
        <div className="budget-edit-list" data-tour="tour-budgets-list">
          {categoryIndex.expenseCategories.map((c) => {
            const spent = st.byCat[c.id] || 0;
            const held = st.byCatHeld[c.id] || 0;
            const budget = budgets[c.id];
            const budgetSet = isBudgetSet(budget);
            const spentPct = budgetSet ? spent / budget : 0;
            const committed = spent + held;
            const over = budgetSet && committed > budget;
            const available = budgetSet ? budget - committed : 0;
            return (
              <div key={c.id} className="bedit">
                <div className="be-top">
                  <div className="be-name">
                    <CatGlyph glyph={c.glyph} id={c.id} /> {c.name}
                    {held > 0 ? (
                      <span className="budget-hold" title="Budget hold active">
                        <Icon name="lock" size={11} />
                        {fmtMoney(held, { currency })}
                      </span>
                    ) : null}
                    {isSavingsCategory(c) && setView ? (
                      <button
                        type="button"
                        className="link-btn be-piggy-link"
                        onClick={() => setView("piggies")}
                      >
                        View Piggy
                      </button>
                    ) : null}
                  </div>
                  {editId === c.id ? (
                    <>
                      {draftIsExpression ? (
                        <FadeIn className="amount-live-total">
                          = {fmtMoney(draftEvaluated, { currency })}
                        </FadeIn>
                      ) : null}
                      <div className="be-edit">
                        <span className="be-cur">{getCurrency(currency).symbol}</span>
                        <input
                          autoFocus
                          disabled={budgetsSaving}
                          type="text"
                          inputMode="text"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit();
                            if (e.key === "Escape") setEditId(null);
                          }}
                          onBlur={commit}
                        />
                      </div>
                    </>
                  ) : (
                    <button
                      className={"be-amt" + (over ? " over" : "")}
                      onClick={() => startEdit(c.id)}
                    >
                      {fmtMoney(spent, { currency })}{" "}
                      <span className="br-of">/ {fmtBudgetLimit(budget, { currency })}</span>
                    </button>
                  )}
                </div>
                <div className="br-track tall">
                  <div
                    className="br-fill"
                    style={{
                      width: Math.min(spentPct, 1) * 100 + "%",
                      background: over ? "var(--danger)" : c.color,
                    }}
                  />
                </div>
                <div className="be-meta">
                  {!budgetSet ? (
                    <span>Unset</span>
                  ) : over ? (
                    <span className="br-over-txt">
                      Over budget by {fmtMoney(committed - budget, { currency })}
                    </span>
                  ) : held > 0 ? (
                    <span>
                      {fmtMoney(available, { currency })} available ·{" "}
                      {fmtMoney(spent, { currency })} {isSavingsCategory(c) ? "saved" : "spent"} ·{" "}
                      {fmtMoney(held, { currency })} held
                    </span>
                  ) : (
                    <span>{fmtMoney(budget - spent, { currency })} remaining</span>
                  )}
                  <span className="be-subs">{c.subs.map((s) => s.name).join(" · ")}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

type InsightsProps = {
  expenses: Expense[];
  budgets: Budgets;
  wallet: FinancialWallet | null | undefined;
  month: string;
  currency: string;
  categoryIndex: CategoryIndex;
  capitalPlans: CapitalPlan[];
  setMonth: (month: string) => void;
};

// ── Insights ────────────────────────────────────────────────────────
export function Insights({
  expenses,
  budgets,
  wallet,
  month,
  currency,
  categoryIndex,
  capitalPlans,
  setMonth,
}: InsightsProps) {
  const { accent } = useTheme();
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("monthly");
  const [habitPeriod, setHabitPeriod] = useState<HabitPeriod>("month");
  const [incomeWindow, setIncomeWindow] = useState<IncomeWindow>("6mo");
  const [viewCurrency, setViewCurrency] = useState(currency);
  const [fxRates, setFxRates] = useState<Record<string, number> | null>(null);
  const [fxStatus, setFxStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    setViewCurrency(currency);
  }, [currency]);

  useEffect(() => {
    let cancelled = false;
    setFxStatus("loading");
    setFxRates(null);
    fetchFxRates(currency)
      .then((fx) => {
        if (cancelled) return;
        setFxRates(fx.rates);
        setFxStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setFxRates({ [currency]: 1 });
        setFxStatus("error");
        setViewCurrency(currency);
      });
    return () => {
      cancelled = true;
    };
  }, [currency]);

  const canConvert =
    viewCurrency === currency ||
    (fxStatus === "ready" && typeof fxRates?.[viewCurrency] === "number");
  const displayCurrency = canConvert ? viewCurrency : currency;
  const money = (n: number) =>
    fmtMoney(roundMoney(fxConvert(n, currency, displayCurrency, fxRates)), {
      currency: displayCurrency,
    });

  const spendingBudgets = Object.fromEntries(
    Object.entries(budgets).filter(([id]) => {
      const cat = categoryIndex.catById[id];
      return cat ? isSpendingCategory(cat) : id !== "income" && id !== "savings";
    }),
  );
  const totalBudget = Object.values(spendingBudgets).reduce((s, v) => s + v, 0);
  const chartMonths = useMemo(() => monthsWindow(month), [month]);

  /*
   * Insights only carries the wallet-scoped 36-month `expenses` window (not
   * the all-time savingsTxns the Piggies view uses), so balances shown here
   * are windowed rather than lifetime — fine for pace/streak analysis, not
   * meant to be read as a piggy's true balance.
   */
  const savingsSlice = useMemo(
    () => expenses.filter((e) => ["savings", "withdrawal"].includes(classifyTx(e, categoryIndex))),
    [expenses, categoryIndex],
  );
  const windowedPiggies = useMemo(
    () => buildPiggies(savingsSlice, categoryIndex),
    [savingsSlice, categoryIndex],
  );
  const savingsInsights = useMemo(
    () =>
      computeSavingsInsights(
        savingsSlice,
        expenses,
        windowedPiggies,
        categoryIndex,
        month,
        SAVINGS_WINDOW_MONTHS,
        capitalPlans,
      ),
    [savingsSlice, expenses, windowedPiggies, categoryIndex, month, capitalPlans],
  );

  /** Pre-aggregate spend and income by month and category once for Insights charts. */
  const monthlyAgg = useMemo(() => {
    const monthKeys = new Set(chartMonths.map((m) => m.key));
    type Bucket = {
      spent: number;
      earned: number;
      byCat: Record<string, number>;
      /** Income keyed by subcategory — most wallets have a single income category. */
      byIncomeSub: Record<string, number>;
    };
    const byMonth = new Map<string, Bucket>();
    for (const key of monthKeys)
      byMonth.set(key, { spent: 0, earned: 0, byCat: {}, byIncomeSub: {} });

    for (const e of expenses) {
      const key = e.date.slice(0, 7);
      if (!monthKeys.has(key)) continue;
      const bucket = byMonth.get(key)!;
      const cat = catOf(e.sub, categoryIndex);

      const cls = classifyTx(e, categoryIndex);
      if (cls === "withdrawal") continue;
      if (cls === "income") {
        bucket.earned += e.amount;
        bucket.byIncomeSub[e.sub] = (bucket.byIncomeSub[e.sub] || 0) + e.amount;
        continue;
      }
      if (!isOutgoing(e) || isSavings(e, categoryIndex)) continue;
      bucket.spent += e.amount;
      bucket.byCat[cat] = (bucket.byCat[cat] || 0) + e.amount;
    }

    return byMonth;
  }, [expenses, chartMonths, categoryIndex]);

  const chartBars = useMemo(() => {
    return spendingChartSeries(chartPeriod, expenses, month, categoryIndex).map((bar) => ({
      ...bar,
      spent: roundMoney(fxConvert(bar.spent, currency, displayCurrency, fxRates)),
      earned: roundMoney(fxConvert(bar.earned, currency, displayCurrency, fxRates)),
    }));
  }, [chartPeriod, expenses, month, categoryIndex, currency, displayCurrency, fxRates]);
  const chartBudget = useMemo(
    () =>
      roundMoney(
        fxConvert(
          chartBudgetForPeriod(chartPeriod, totalBudget, month),
          currency,
          displayCurrency,
          fxRates,
        ),
      ),
    [chartPeriod, totalBudget, month, currency, displayCurrency, fxRates],
  );
  const activeChartKey = chartActiveKey(chartPeriod, month);
  const cur = useMemo(
    () => monthStats(expenses, budgets, wallet ?? EMPTY_WALLET, month, categoryIndex),
    [expenses, budgets, wallet, month, categoryIndex],
  );
  const idx = MONTHS.findIndex((m) => m.key === month);
  const prevKey = idx > 0 ? (MONTHS[idx - 1]?.key ?? null) : null;
  const prev = useMemo(
    () =>
      prevKey
        ? monthStats(expenses, budgets, wallet ?? EMPTY_WALLET, prevKey, categoryIndex)
        : null,
    [expenses, budgets, wallet, prevKey, categoryIndex],
  );

  const catRows = useMemo(
    () =>
      // Retired envelopes stay in the list while they still have spend anywhere
      // in the charted window, so the rows keep summing to the period total.
      spendingCategoriesFor(categoryIndex, (id) =>
        chartMonths.some((mo) => (monthlyAgg.get(mo.key)?.byCat[id] || 0) > 0),
      )
        .map((c) => {
          const now = cur.byCat[c.id] || 0;
          const was = prev ? prev.byCat[c.id] || 0 : 0;
          const series = chartMonths.map((mo) =>
            roundMoney(
              fxConvert(
                monthlyAgg.get(mo.key)?.byCat[c.id] || 0,
                currency,
                displayCurrency,
                fxRates,
              ),
            ),
          );
          const delta = was ? (now - was) / was : now > 0 ? 1 : 0;

          return { c, now, was, delta, series };
        })
        .sort((a, b) => b.now - a.now),
    [categoryIndex, cur.byCat, prev, chartMonths, monthlyAgg, currency, displayCurrency, fxRates],
  );

  // top subcategories this month
  const subTotals: Record<string, number> = {};
  cur.list
    .filter((e) => isOutgoing(e) && !isSavings(e, categoryIndex))
    .forEach((e) => {
      subTotals[e.sub] = (subTotals[e.sub] || 0) + e.amount;
    });
  const topSubs = Object.entries(subTotals)
    .map(([sub, v]) => ({ sub, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 6);
  const maxSub = topSubs.length ? (topSubs[0]?.v ?? 1) : 1;

  // ── Income ────────────────────────────────────────────────────────
  /** Income totals per subcategory for one month's transactions. */
  const incomeBySub = useCallback(
    (list: Expense[]) => {
      const totals: Record<string, number> = {};
      for (const e of list) {
        if (classifyTx(e, categoryIndex) !== "income") continue;
        totals[e.sub] = (totals[e.sub] || 0) + e.amount;
      }

      return totals;
    },
    [categoryIndex],
  );

  /** One row per income source that has ever paid out inside the chart window. */
  const incomeRows = useMemo(() => {
    const now = incomeBySub(cur.list);
    const was = prev ? incomeBySub(prev.list) : {};
    const sources = new Set([...Object.keys(now), ...Object.keys(was)]);
    for (const mo of chartMonths) {
      for (const sub of Object.keys(monthlyAgg.get(mo.key)?.byIncomeSub ?? {})) sources.add(sub);
    }

    return [...sources]
      .map((sub) => {
        const meta = categoryIndex.subById[sub];
        const cat = meta ? categoryIndex.catById[meta.catId] : null;
        const amount = now[sub] || 0;
        const before = was[sub] || 0;
        const series = chartMonths.map((mo) =>
          roundMoney(
            fxConvert(
              monthlyAgg.get(mo.key)?.byIncomeSub[sub] || 0,
              currency,
              displayCurrency,
              fxRates,
            ),
          ),
        );

        return {
          sub,
          name: meta?.name ?? sub,
          cat,
          now: amount,
          delta: before ? (amount - before) / before : amount > 0 ? 1 : 0,
          series,
        };
      })
      .filter((row) => row.cat)
      .sort((a, b) => b.now - a.now);
  }, [
    categoryIndex.subById,
    categoryIndex.catById,
    cur.list,
    prev,
    chartMonths,
    monthlyAgg,
    currency,
    displayCurrency,
    fxRates,
    incomeBySub,
  ]);

  // top income sources this month
  const topIncomeSubs = Object.entries(incomeBySub(cur.list))
    .map(([sub, v]) => ({ sub, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 6);
  const maxIncomeSub = topIncomeSubs.length ? (topIncomeSubs[0]?.v ?? 1) : 1;

  const earnedDelta = prev ? cur.earned - prev.earned : 0;
  const netKept = cur.earned - cur.spent;
  const keptPct = cur.earned ? Math.round((netKept / cur.earned) * 100) : 0;

  const habit = useMemo(
    () => assessSpendingHabit(expenses, habitPeriod, month, categoryIndex),
    [expenses, habitPeriod, month, categoryIndex],
  );
  const habitTrail = useMemo(
    () => habitTrajectory(expenses, month, categoryIndex),
    [expenses, month, categoryIndex], // deliberately NOT habitPeriod — the trail is always the trailing 6 months
  );
  const habitTrailMaxSpend = useMemo(
    () => Math.max(...habitTrail.map((p) => p.spend), 1),
    [habitTrail],
  );
  const habitStory = useMemo(() => {
    if (habit.status !== "ready") return null;
    return {
      narrative: buildHabitNarrative(habit.style.id, habit.metrics, { money }),
      shift: describeHabitShift(habitTrail),
    };
    // `money` is a fresh closure every render — depend on its real inputs instead, so an
    // unrelated re-render doesn't rebuild the narrative/shift strings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habit, habitTrail, currency, displayCurrency, fxRates]);
  const incomeProfile = useMemo(
    () => assessIncomeProfile(expenses, month, incomeWindow, categoryIndex),
    [expenses, month, incomeWindow, categoryIndex],
  );
  const incomeStory = useMemo(() => {
    if (incomeProfile.status !== "ready") return null;
    return {
      narrative: buildIncomeNarrative(incomeProfile.style.id, incomeProfile.metrics, { money }),
    };
    // Same reasoning as habitStory: `money` is a fresh closure every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomeProfile, currency, displayCurrency, fxRates]);
  const showDeclaredIncomeNote = declaresMonthlyIncome(wallet);

  const viewRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useEnter(viewRef);
  useStagger(gridRef, ".summary-card");

  return (
    <div ref={viewRef} className="view">
      <div className="insights-fx" data-tour="tour-insights-fx">
        <div className="insights-fx-main">
          <label className="fld-label" htmlFor="insights-currency">
            View in
          </label>
          <CurrencyPicker
            id="insights-currency"
            className="insights-fx-select"
            value={viewCurrency}
            onChange={setViewCurrency}
            badgeFor={(code) => (code === currency ? "wallet" : null)}
          />
        </div>
      </div>

      <div className="ov-grid" data-tour="tour-insights-trends">
        <section className="panel">
          <div className="panel-head">
            <h2>Category Trends</h2>
            <p className="panel-sub">vs previous month</p>
          </div>
          <div className="cat-trend-list">
            {catRows.map(({ c, now, delta, series }) => (
              <div key={c.id} className="ctrow">
                <div className="ct-name">
                  <CatGlyph glyph={c.glyph} id={c.id} /> {c.name}
                </div>
                <MiniSpark values={series} color={c.color} />
                <div className="ct-amt">{money(now)}</div>
                <div
                  className={
                    "ct-delta " + (delta > 0.001 ? "up" : delta < -0.001 ? "down" : "flat")
                  }
                >
                  {delta > 0.001 ? "▲" : delta < -0.001 ? "▼" : "—"}{" "}
                  {Math.abs(Math.round(delta * 100))}%
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Top Subcategories</h2>
            <p className="panel-sub">{monthLabel(month, true)}</p>
          </div>
          <div className="topsub-list">
            {topSubs.map(({ sub, v }) => {
              const s = categoryIndex.subById[sub];
              const c = s ? categoryIndex.catById[s.catId] : null;
              if (!s || !c) return null;
              return (
                <div key={sub} className="ts-row">
                  <div className="ts-head">
                    <span>
                      {s.name} <span className="ts-cat">· {c.name}</span>
                    </span>
                    <span className="ts-amt">{money(v)}</span>
                  </div>
                  <div className="ts-track">
                    <div
                      className="ts-fill"
                      style={{ width: (v / maxSub) * 100 + "%", background: c.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="insights-section" data-tour="tour-insights-habits">
        <div className="insights-section-head">
          <h2>Spending Habit</h2>
        </div>
        <section className="panel">
          <div className="panel-head profile-head profile-head-solo">
            <Segmented
              options={[
                { v: "month", label: "Per Month" },
                { v: "year", label: "Per Year" },
                { v: "rolling90", label: "Last 90 Days" },
              ]}
              value={habitPeriod}
              onChange={setHabitPeriod}
            />
          </div>

          {habit.status === "insufficient" ? (
            <div className="profile-locked">
              <div className="profile-locked-mark" aria-hidden="true">
                ◌
              </div>
              <div className="profile-locked-copy">
                <p className="profile-locked-title">Style unlocks after 5 days of transactions</p>
                <p className="profile-locked-sub">
                  {habit.daysHave === 0
                    ? `No outgoing spend days yet in ${habit.periodLabel}.`
                    : `${habit.daysHave} of ${habit.daysNeeded} active days in ${habit.periodLabel}.`}{" "}
                  {habit.daysNeeded - habit.daysHave} more spending days to unlock.
                </p>
              </div>
              <div
                className="profile-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={habit.daysNeeded}
                aria-valuenow={habit.daysHave}
                aria-label="Transaction Days Toward Habit Unlock"
              >
                <div
                  className="profile-progress-fill"
                  style={{ width: `${(habit.daysHave / habit.daysNeeded) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <div className={"profile-result profile-tinted style-" + habit.style.id}>
              <div className="profile-top">
                <div className="profile-identity">
                  <div className="profile-crown">
                    <p className="profile-temperament">{habit.style.temperament}</p>
                    <span className={"profile-confidence conf-" + habit.confidence.level}>
                      {habit.confidence.level} confidence
                    </span>
                  </div>
                  <h3 className="profile-title">
                    {habit.style.title}
                    {habit.blend.secondary && (
                      <span className="profile-blend">
                        {" "}
                        with a {habit.blend.secondary.trait} streak
                      </span>
                    )}
                  </h3>
                </div>
                {habitStory && (
                  <div className="profile-copy">
                    <div className="profile-block">
                      <p className="profile-kicker">Data Pattern</p>
                      <p>{habitStory.narrative.pattern}</p>
                    </div>
                    <div className="profile-block">
                      <p className="profile-kicker">Behavior</p>
                      <p>{habitStory.narrative.behavior}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="profile-signals">
                <div className="profile-signal">
                  <p className="psig-label">Busiest day</p>
                  <p className="psig-value">
                    {habit.metrics.topDowSampleDate
                      ? weekdayLabel(habit.metrics.topDowSampleDate)
                      : "—"}
                  </p>
                  <p className="psig-hint">
                    {Math.round(habit.metrics.topDowShare * 100)}% of transactions
                  </p>
                </div>
              </div>

              <div className="profile-trajectory">
                <p className="ptrl-note">{habitStory?.shift}</p>
                <div className="ptrl-grid">
                  {habitTrail.map((pt) => {
                    const isReady = pt.status === "ready";
                    return (
                      <button
                        key={pt.monthKey}
                        type="button"
                        className={
                          "ptrl-col profile-tinted " +
                          (isReady ? "style-" + pt.styleId : "") +
                          (pt.monthKey === month ? " is-active" : "")
                        }
                        onClick={() => setMonth(pt.monthKey)}
                        disabled={!isReady}
                      >
                        <div
                          className={"ptrl-bar" + (isReady ? "" : " is-empty")}
                          style={{
                            height: isReady
                              ? `${Math.max(6, (pt.spend / habitTrailMaxSpend) * 100)}%`
                              : "4px",
                          }}
                        />
                        <p className="ptrl-label">{monthLabel(pt.monthKey, false).split(" ")[0]}</p>
                        <p className="ptrl-style">{isReady ? pt.tag : "—"}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <div ref={gridRef} className="summary-grid sg-2">
        <SummaryCard
          label="This Month"
          tone="spent"
          value={money(cur.spent)}
          sub={monthLabel(month, false)}
        />
        <SummaryCard
          label="Vs Last Month"
          tone={prev && cur.spent > prev.spent ? "danger" : "saved"}
          value={
            prev
              ? (cur.spent >= prev.spent ? "+" : "−") + money(Math.abs(cur.spent - prev.spent))
              : "—"
          }
          sub={
            prev
              ? `${Math.round((Math.abs(cur.spent - prev.spent) / (prev.spent || 1)) * 100)}% ${cur.spent >= prev.spent ? "higher" : "lower"}`
              : "no prior data"
          }
        />
      </div>

      <section className="panel" data-tour="tour-insights-chart">
        <div className="panel-head insights-chart-head">
          <div>
            <h2>Month Over Month</h2>
          </div>
          <Segmented
            options={[
              { v: "daily", label: "Daily" },
              { v: "monthly", label: "Monthly" },
              { v: "quarterly", label: "Quarterly" },
              { v: "yearly", label: "Yearly" },
            ]}
            value={chartPeriod}
            onChange={setChartPeriod}
          />
        </div>
        <MoMBars
          months={chartBars}
          accent={accent}
          activeKey={activeChartKey}
          onSelect={(key) => setMonth(chartSelectionMonth(chartPeriod, key))}
          budget={chartBudget}
          format={money}
        />
      </section>

      <div className="insights-section" data-tour="tour-insights-income">
        <div className="insights-section-head">
          <h2>Income</h2>
        </div>

        <div className="ov-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Income Trends</h2>
              <p className="panel-sub">by source · vs previous month</p>
            </div>
            <div className="cat-trend-list">
              {incomeRows.length ? (
                incomeRows.map(({ sub, name, cat, now, delta, series }) => (
                  <div key={sub} className="ctrow">
                    <div className="ct-name">
                      <CatGlyph glyph={cat!.glyph} id={cat!.id} /> {name}
                    </div>
                    <MiniSpark values={series} color={cat!.color} />
                    <div className="ct-amt">{money(now)}</div>
                    <div
                      className={
                        "ct-delta ct-delta--income " +
                        (delta > 0.001 ? "up" : delta < -0.001 ? "down" : "flat")
                      }
                    >
                      {delta > 0.001 ? "▲" : delta < -0.001 ? "▼" : "—"}{" "}
                      {Math.abs(Math.round(delta * 100))}%
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No Income Yet"
                  sub="Log an income transaction to see trends here."
                />
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Top Income Sources</h2>
              <p className="panel-sub">{monthLabel(month, true)}</p>
            </div>
            <div className="topsub-list">
              {topIncomeSubs.length ? (
                topIncomeSubs.map(({ sub, v }) => {
                  const s = categoryIndex.subById[sub];
                  const c = s ? categoryIndex.catById[s.catId] : null;
                  if (!s || !c) return null;
                  return (
                    <div key={sub} className="ts-row">
                      <div className="ts-head">
                        <span>
                          {s.name} <span className="ts-cat">· {c.name}</span>
                        </span>
                        <span className="ts-amt">{money(v)}</span>
                      </div>
                      <div className="ts-track">
                        <div
                          className="ts-fill"
                          style={{ width: (v / maxIncomeSub) * 100 + "%", background: c.color }}
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyState
                  title="Nothing Earned"
                  sub={`No income recorded in ${monthLabel(month, true)}.`}
                />
              )}
            </div>
          </section>
        </div>

        <section className="panel">
          <div className="panel-head profile-head">
            <div>
              <h2>Income Profile</h2>
              <p className="panel-sub">
                {incomeProfile.status === "ready"
                  ? `Based on income in ${incomeProfile.windowLabel}`
                  : `Needs a bit more history · ${incomeProfile.windowLabel}`}
              </p>
            </div>
            <Segmented
              options={[
                { v: "6mo", label: "Last 6 Months" },
                { v: "12mo", label: "Last 12 Months" },
              ]}
              value={incomeWindow}
              onChange={setIncomeWindow}
            />
          </div>

          {incomeProfile.status === "insufficient" ? (
            <div className="profile-locked">
              <div className="profile-locked-mark" aria-hidden="true">
                ◌
              </div>
              <div className="profile-locked-copy">
                <p className="profile-locked-title">
                  Profile unlocks after {INCOME_MIN_EVENTS} payments across {INCOME_MIN_MONTHS}{" "}
                  months
                </p>
                <p className="profile-locked-sub">
                  {incomeProfile.txHave === 0
                    ? `No income logged yet in ${incomeProfile.windowLabel}.`
                    : `${incomeProfile.txHave} of ${incomeProfile.txNeeded} payments · ${incomeProfile.monthsHave} of ${incomeProfile.monthsNeeded} months in ${incomeProfile.windowLabel}.`}
                </p>
              </div>
              <div
                className="profile-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={incomeProfile.txNeeded}
                aria-valuenow={Math.min(incomeProfile.txHave, incomeProfile.txNeeded)}
                aria-label="Payments Toward Income Profile Unlock"
              >
                <div
                  className="profile-progress-fill"
                  style={{
                    width: `${Math.min(100, (incomeProfile.txHave / incomeProfile.txNeeded) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className={"profile-result profile-tinted style-" + incomeProfile.style.id}>
              <div className="profile-top">
                <div className="profile-identity">
                  <div className="profile-crown">
                    <p className="profile-temperament">{incomeProfile.style.temperament}</p>
                    <span className={"profile-confidence conf-" + incomeProfile.confidence.level}>
                      {incomeProfile.confidence.level} confidence
                    </span>
                  </div>
                  <h3 className="profile-title">
                    {incomeProfile.style.title}
                    {incomeProfile.blend.secondary && (
                      <span className="profile-blend">
                        {" "}
                        with a {incomeProfile.blend.secondary.trait} streak
                      </span>
                    )}
                  </h3>
                </div>
                {incomeStory && (
                  <div className="profile-copy">
                    <div className="profile-block">
                      <p className="profile-kicker">Data Pattern</p>
                      <p>{incomeStory.narrative.pattern}</p>
                    </div>
                    <div className="profile-block">
                      <p className="profile-kicker">Behavior</p>
                      <p>{incomeStory.narrative.behavior}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {showDeclaredIncomeNote && (
            <p className="profile-callout">
              Wallet declares {money(wallet?.income ?? 0)}/mo on top of logged income. Logged income
              averages{" "}
              {incomeProfile.status === "ready" ? money(incomeProfile.metrics.monthlyMean) : "—"}
              /mo — if your salary is logged as a transaction, the pool counts it twice.
            </p>
          )}
        </section>

        <div className="summary-grid sg-3">
          <SummaryCard
            label="Income This Month"
            tone="saved"
            value={money(cur.earned)}
            sub={monthLabel(month, false)}
          />
          <SummaryCard
            label="Vs Last Month"
            tone={!prev || earnedDelta === 0 ? undefined : earnedDelta > 0 ? "saved" : "danger"}
            value={prev ? (earnedDelta >= 0 ? "+" : "−") + money(Math.abs(earnedDelta)) : "—"}
            sub={
              prev
                ? `${Math.round((Math.abs(earnedDelta) / (prev.earned || 1)) * 100)}% ${earnedDelta >= 0 ? "higher" : "lower"}`
                : "no prior data"
            }
          />
          <SummaryCard
            label="Net Kept"
            tone={netKept < 0 ? "danger" : "ok"}
            value={money(netKept)}
            sub={cur.earned ? `${keptPct}% of income kept` : "no income recorded"}
          />
        </div>
      </div>

      <section className="panel insights-savings" data-tour="tour-insights-savings">
        <div className="panel-head">
          <div>
            <h2>Saving Insights</h2>
          </div>
        </div>
        <div className="summary-grid sg-2">
          <SummaryCard
            label="To Capitals"
            tone="ok"
            value={money(savingsInsights.capitalNetFlow)}
            sub={`${money(savingsInsights.piggyNetFlow)} to piggies`}
          />
          <SummaryCard
            label="Streak"
            value={String(savingsInsights.currentStreak)}
            sub={savingsInsights.currentStreak === 1 ? "month saving" : "months saving"}
          />
        </div>
        {savingsInsights.headlines.length ? (
          <ul className="piggy-headlines piggy-headlines--spaced">
            {savingsInsights.headlines.map((h) => (
              <li key={h.id} className={`piggy-headline piggy-headline--${h.tone}`}>
                {h.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel-sub piggy-headlines-empty">
            Keep saving to unlock streaks, pace, and projections here.
          </p>
        )}
        <CapitalPaceList plans={savingsInsights.perPlan} money={money} />
      </section>
    </div>
  );
}

type RecurringProps = {
  expenses: Expense[];
  month: string;
  currency: string;
  categoryIndex: CategoryIndex;
  onEdit: (expense: Expense) => void;
};

// ── Recurring ───────────────────────────────────────────────────────
export function Recurring({ expenses, month, currency, categoryIndex, onEdit }: RecurringProps) {
  const list = recurringSchedulesForMonth(expenses, month);
  const total = roundMoney(list.reduce((s, e) => s + e.amount, 0));
  const monthlyEq = roundMoney(
    list.reduce((s, e) => s + recurringMonthlyEquivalent(e.amount, e.recurring), 0),
  );
  const viewRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useEnter(viewRef);
  useStagger(gridRef, ".summary-card");

  return (
    <div ref={viewRef} className="view">
      <div ref={gridRef} className="summary-grid sg-2" data-tour="tour-recurring-summary">
        <SummaryCard label="Recurring this Month" value={fmtMoney(total, { currency })} />
        <SummaryCard
          label="Monthly Equivalent"
          tone="spent"
          value={fmtMoney(monthlyEq, { currency })}
        />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Fixed & Recurring</h2>
        </div>
        <div className="rec-list" data-tour="tour-recurring-list">
          {list.length ? (
            list.map((e) => {
              const s = categoryIndex.subById[e.sub];
              const c = s ? categoryIndex.catById[s.catId] : null;
              if (!s || !c) return null;
              const dueDay = recurringDueDay(e, month);
              const scheduleKey = recurringScheduleKey(e);
              return (
                <button key={scheduleKey} className="rec-row" onClick={() => onEdit(e)}>
                  <span className="rec-glyph" style={glyphTint(c.color)}>
                    {displayGlyph(c.glyph, c.id)}
                  </span>
                  <span className="rec-main">
                    <span className="rec-note">{e.note}</span>
                    <span className="rec-sub">
                      {c.name} · {s.name} · {recurringLabel(e.recurring)}
                    </span>
                  </span>
                  <span className="rec-day">
                    <span className="rec-day-n">{dueDay}</span>
                    <span className="rec-day-l">{monthLabel(month, false)}</span>
                  </span>
                  <span className="rec-amt">{fmtMoney(e.amount, { currency })}</span>
                </button>
              );
            })
          ) : (
            <EmptyState
              title="No Recurring Items"
              sub="Mark an expense as recurring when adding it."
            />
          )}
        </div>
      </section>
    </div>
  );
}
