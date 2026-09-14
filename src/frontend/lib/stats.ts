import {
  normalizeRecurring,
  recurringDueDay,
  recurringLabel,
  recurringMonthlyEquivalent,
  recurringOccursInMonth,
  recurringScheduleKey,
} from "@/lib/recurring";
import type { CategoryIndex } from "./categories";
import {
  catOfSub,
  isArchivedCategory,
  isIncomeCategory,
  isSavingsSub,
  isSpendingCategory,
} from "./categories";
import {
  CURRENT_MONTH_KEY,
  SUB_BY_ID,
  TODAY_ISO,
  monthLabel,
  monthsWindow,
  roundMoney,
} from "./data";
import type { Budgets, Expense, FinancialWallet, LedgerEvent } from "./types";
import { holdsByCategory, totalActiveHolds } from "./envelope-holds";
import { displayGlyph } from "@/lib/glyphs";

export {
  normalizeRecurring,
  recurringDueDay,
  recurringLabel,
  recurringMonthlyEquivalent,
  recurringScheduleKey,
};

export type ChartPeriod = "daily" | "monthly" | "quarterly" | "yearly";
type ChartBar = { key: string; label: string; spent: number; earned: number };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function quarterOf(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return { year: year!, quarter: Math.ceil(month! / 3) };
}

function quartersWindow(anchorMonth: string, size = 6) {
  let { year, quarter } = quarterOf(anchorMonth);
  const out: { year: number; quarter: number; key: string; label: string }[] = [];
  for (let i = 0; i < size; i++) {
    out.unshift({ year, quarter, key: `${year}-Q${quarter}`, label: `Q${quarter}` });
    quarter -= 1;
    if (quarter < 1) {
      quarter = 4;
      year -= 1;
    }
  }
  return out;
}

/**
 * Spend (outgoing, including savings envelope deposits net of withdrawals)
 * and income totals for a set of transactions, rounded to cents so float
 * drift never leaks into a bar. Savings deposits count toward spend and
 * withdrawals net back against it — the same convention `remaining` and
 * `walletBalance` already use below — so this matches `totalBudget`, which
 * already includes savings envelope budgets; income stays pure `income`.
 */
function flowTotals(expenses: Expense[], index?: CategoryIndex) {
  let spent = 0;
  let earned = 0;

  for (const e of expenses) {
    const cls = classifyTx(e, index);
    if (cls === "income") {
      earned += e.amount;
      continue;
    }
    if (cls === "withdrawal") {
      spent -= e.amount;
      continue;
    }
    spent += e.amount;
  }

  return { spent: roundMoney(spent), earned: roundMoney(earned) };
}

export function spendingChartSeries(
  period: ChartPeriod,
  expenses: Expense[],
  anchorMonth: string,
  index?: CategoryIndex,
): ChartBar[] {
  if (period === "daily") {
    const [year, month] = anchorMonth.split("-").map(Number);
    const days = new Date(year!, month!, 0).getDate();
    const bars: ChartBar[] = [];
    for (let d = 1; d <= days; d++) {
      const key = `${anchorMonth}-${pad2(d)}`;
      const totals = flowTotals(
        expenses.filter((e) => e.date === key),
        index,
      );
      bars.push({ key, label: String(d), ...totals });
    }
    return bars;
  }

  if (period === "monthly") {
    return monthsWindow(anchorMonth).map((mo) => {
      const totals = flowTotals(monthExpenses(expenses, mo.key), index);
      return { key: mo.key, label: monthLabel(mo.key).split(" ")[0] ?? mo.key, ...totals };
    });
  }

  if (period === "quarterly") {
    return quartersWindow(anchorMonth).map(({ year, quarter, key, label }) => {
      const startM = (quarter - 1) * 3 + 1;
      let spent = 0;
      let earned = 0;
      for (let i = 0; i < 3; i++) {
        const monthKey = `${year}-${pad2(startM + i)}`;
        const totals = flowTotals(monthExpenses(expenses, monthKey), index);
        spent += totals.spent;
        earned += totals.earned;
      }
      return {
        key,
        label: `${label} '${String(year).slice(2)}`,
        spent: roundMoney(spent),
        earned: roundMoney(earned),
      };
    });
  }

  const anchorYear = Number(anchorMonth.split("-")[0]);
  const bars: ChartBar[] = [];
  for (let i = 5; i >= 0; i--) {
    const year = anchorYear - i;
    const key = String(year);
    const totals = flowTotals(
      expenses.filter((e) => e.date.startsWith(`${year}-`)),
      index,
    );
    bars.push({ key, label: key, ...totals });
  }
  return bars;
}

/**
 * One line of a day's spend or income: a category total. Subcategories are
 * folded into their parent, so "Meal" and "Snacks" read as one Food & Dining
 * row carrying the category's name, color, and glyph.
 */
type FlowEntry = {
  id: string;
  name: string;
  color: string;
  glyph: string;
  amount: number;
  count: number;
};

/** A single day of the trend line, broken down by spend / income category. */
type DayFlow = {
  /** ISO date, `YYYY-MM-DD`. */
  day: string;
  /** Day of month, matching the trend chart's x label. */
  label: string;
  spent: number;
  earned: number;
  spend: FlowEntry[];
  earn: FlowEntry[];
};

/**
 * Display meta for a subcategory's parent category, falling back to the static
 * taxonomy. Subs with no known parent all collapse into one "Uncategorized" row.
 */
export function catMetaOf(sub: string, index?: CategoryIndex) {
  const catId = catOf(sub, index);
  const cat = index?.catById[catId];

  return {
    id: catId || "uncategorized",
    name: cat?.name ?? (catId || "Uncategorized"),
    color: cat?.color ?? SUB_BY_ID[sub]?.color ?? "#8b93a1",
    glyph: displayGlyph(cat?.glyph, catId),
  };
}

/** Fold one transaction into a day's per-category bucket. */
function addToBucket(bucket: Map<string, FlowEntry>, e: Expense, index?: CategoryIndex) {
  const meta = catMetaOf(e.sub, index);
  const prev = bucket.get(meta.id);

  if (prev) {
    prev.amount += e.amount;
    prev.count += 1;
    return;
  }

  bucket.set(meta.id, { ...meta, amount: e.amount, count: 1 });
}

/** Largest slice first, then alphabetical so equal amounts keep a stable order. */
function byAmountDesc(a: FlowEntry, b: FlowEntry) {
  return b.amount - a.amount || a.name.localeCompare(b.name);
}

function sealEntries(bucket?: Map<string, FlowEntry>) {
  return [...(bucket?.values() ?? [])]
    .map((entry) => ({ ...entry, amount: roundMoney(entry.amount) }))
    .sort(byAmountDesc);
}

/**
 * Per-day spend and income for `monthKey`, each broken down by category with
 * its subcategories combined. Mirrors the overview trend line: savings
 * deposits count as spend (they show up as their own category row, same as
 * any other spend), and withdrawals net back against the day's spend total —
 * matching `flowTotals` above and `remaining`/`walletBalance` below, and
 * matching `totalBudget`, which already includes savings envelope budgets.
 * A withdrawal is a day-level adjustment, not its own category row: showing
 * a negative-amount slice in the per-category breakdown would look broken.
 * Days run 1..`upToDay` (defaults to the whole month) so the series lines up
 * with the plotted points.
 */
export function dayFlowSeries(
  expenses: Expense[],
  monthKey: string,
  index?: CategoryIndex,
  upToDay?: number,
): DayFlow[] {
  const [year, month] = monthKey.split("-").map(Number);
  const days = new Date(year!, month!, 0).getDate();
  const last = Math.max(1, Math.min(upToDay ?? days, days));
  const spendByDay = new Map<string, Map<string, FlowEntry>>();
  const earnByDay = new Map<string, Map<string, FlowEntry>>();
  const withdrawnByDay = new Map<string, number>();

  for (const e of expenses) {
    if (!inMonth(e.date, monthKey)) continue;
    const cls = classifyTx(e, index);
    if (cls === "withdrawal") {
      withdrawnByDay.set(e.date, (withdrawnByDay.get(e.date) ?? 0) + e.amount);
      continue;
    }
    const target = cls === "income" ? earnByDay : spendByDay;
    let bucket = target.get(e.date);
    if (!bucket) {
      bucket = new Map();
      target.set(e.date, bucket);
    }
    addToBucket(bucket, e, index);
  }

  const out: DayFlow[] = [];
  for (let d = 1; d <= last; d++) {
    const day = `${monthKey}-${pad2(d)}`;
    const spend = sealEntries(spendByDay.get(day));
    const earn = sealEntries(earnByDay.get(day));
    const spentGross = spend.reduce((s, x) => s + x.amount, 0);
    const withdrawn = withdrawnByDay.get(day) ?? 0;
    out.push({
      day,
      label: String(d),
      spent: roundMoney(spentGross - withdrawn),
      earned: roundMoney(earn.reduce((s, x) => s + x.amount, 0)),
      spend,
      earn,
    });
  }

  return out;
}

export function chartActiveKey(period: ChartPeriod, anchorMonth: string) {
  if (period === "monthly") return anchorMonth;
  if (period === "daily") {
    return anchorMonth === CURRENT_MONTH_KEY ? TODAY_ISO : `${anchorMonth}-01`;
  }
  if (period === "quarterly") {
    const { year, quarter } = quarterOf(anchorMonth);
    return `${year}-Q${quarter}`;
  }
  return anchorMonth.split("-")[0];
}

export function chartBudgetForPeriod(
  period: ChartPeriod,
  monthlyBudget: number,
  anchorMonth: string,
) {
  if (!monthlyBudget) return 0;
  if (period === "monthly") return monthlyBudget;
  if (period === "daily") {
    const [year, month] = anchorMonth.split("-").map(Number);
    const days = new Date(year!, month!, 0).getDate();
    return monthlyBudget / days;
  }
  if (period === "quarterly") return monthlyBudget * 3;
  return monthlyBudget * 12;
}

export function chartSelectionMonth(period: ChartPeriod, key: string) {
  if (period === "monthly") return key;
  if (period === "daily") return key.slice(0, 7);
  if (period === "quarterly") {
    const [yearPart, quarterPart] = key.split("-Q");
    const quarter = Number(quarterPart);
    const month = pad2((quarter - 1) * 3 + 1);
    return `${yearPart}-${month}`;
  }
  return `${key}-01`;
}

const inMonth = (iso: string, key: string) => iso.slice(0, 7) === key;

export function monthExpenses(expenses: Expense[], key: string) {
  return expenses.filter((e) => inMonth(e.date, key));
}

/** Entry-time key for same-date ordering (newest first). Falls back to ObjectId time, then id. */
function expenseEntryTime(expense: Expense): string {
  if (expense.createdAt) return expense.createdAt;

  const hex = expense.id;
  if (/^[a-f0-9]{24}$/i.test(hex)) {
    const secs = Number.parseInt(hex.slice(0, 8), 16);
    if (Number.isFinite(secs)) return new Date(secs * 1000).toISOString();
  }

  return expense.id;
}

/** Sort expenses by date descending, then entry time descending (latest first). */
export function sortExpensesByDateDesc(expenses: Expense[]): Expense[] {
  return [...expenses].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;

    const at = expenseEntryTime(a);
    const bt = expenseEntryTime(b);
    if (at !== bt) return at < bt ? 1 : -1;

    return b.id.localeCompare(a.id);
  });
}

export const isIncome = (e: Expense) => e.kind === "income";
export const isOutgoing = (e: Expense) => e.kind !== "income";

export function isRecurring(e: Pick<Expense, "recurring">) {
  return normalizeRecurring(e.recurring) !== false;
}

export function recurringSchedulesForMonth(expenses: Expense[], monthKey: string) {
  const anchors = expenses.filter((e) => isOutgoing(e) && isRecurring(e));
  const byKey = new Map<string, Expense>();
  anchors.forEach((e) => {
    const key = recurringScheduleKey(e);
    const prev = byKey.get(key);
    if (!prev || e.date > prev.date) byKey.set(key, e);
  });
  return [...byKey.values()]
    .filter((e) => recurringOccursInMonth(e, monthKey))
    .sort(
      (a, b) =>
        recurringDueDay(a, monthKey) - recurringDueDay(b, monthKey) || a.note.localeCompare(b.note),
    );
}

export function catOf(sub: string, index?: CategoryIndex) {
  if (index) return catOfSub(sub, index.subById);

  return SUB_BY_ID[sub]?.catId ?? "";
}

/** Which pool a transaction belongs to for every analytics calculation. */
type TxClass = "spend" | "savings" | "withdrawal" | "income";

/**
 * Single source of truth for splitting transactions into spend / savings /
 * withdrawal / income, honouring user-created categories of all three types.
 *
 * Resolution order matters:
 *
 * 1. The taxonomy is checked first, via the category's `type`. This is what
 *    picks up user-created savings envelopes; the static `SUB_BY_ID` fallback
 *    below cannot see them, which is why callers that classify should always
 *    pass an index.
 * 2. `kind` then decides which side of a savings envelope a transaction is
 *    on: an outgoing (`expense`) transaction against a savings sub is a
 *    deposit, an incoming (`income`) transaction against a savings sub is a
 *    withdrawal — money the user is taking back out. `kind` alone still
 *    decides plain income vs. spend for every non-savings sub.
 * 3. Everything else is spend — including subcategories orphaned by a deleted
 *    category. An orphan's type is genuinely unrecoverable, so spend is both
 *    the safe default and the correct answer for the common case of a deleted
 *    expense category. Archived categories (see `buildCategoryIndex`) stay in
 *    the index precisely so savings history does not fall through to here.
 */
export function classifyTx(e: Expense, index?: CategoryIndex): TxClass {
  const savings = index
    ? isSavingsSub(e.sub, index.subById, index.catById)
    : catOf(e.sub) === "savings";

  if (isIncome(e)) return savings ? "withdrawal" : "income";

  return savings ? "savings" : "spend";
}

export function isSavings(e: Expense, index?: CategoryIndex) {
  return classifyTx(e, index) === "savings";
}

/** True when the transaction counts toward spending (not savings, not income). */
export function isSpend(e: Expense, index?: CategoryIndex) {
  return classifyTx(e, index) === "spend";
}

export type WalletFunding = Pick<FinancialWallet, "fundingMode" | "income" | "startingBalance">;

export function walletBalance(expenses: Expense[], wallet: WalletFunding, index?: CategoryIndex) {
  let spent = 0;
  let saved = 0;
  let earned = 0;
  let withdrawn = 0;

  for (const e of expenses) {
    const cls = classifyTx(e, index);
    if (cls === "income") earned += e.amount;
    else if (cls === "withdrawal") withdrawn += e.amount;
    else if (cls === "savings") saved += e.amount;
    else spent += e.amount;
  }

  return wallet.startingBalance + earned + withdrawn - spent - saved;
}

export function monthStats(
  expenses: Expense[],
  budgets: Budgets,
  wallet: WalletFunding,
  key: string,
  index?: CategoryIndex,
  events?: LedgerEvent[],
  opts?: { balanceExpenses?: Expense[] },
) {
  const list: Expense[] = [];
  let spent = 0;
  let saved = 0;
  let earned = 0;
  let withdrawn = 0;
  const byCat: Record<string, number> = {};
  const bySub: Record<string, number> = {};

  for (const e of expenses) {
    if (!inMonth(e.date, key)) continue;
    list.push(e);

    const cls = classifyTx(e, index);

    if (cls === "income") {
      earned += e.amount;
      continue;
    }

    const cat = catOf(e.sub, index);

    if (cls === "withdrawal") {
      withdrawn += e.amount;
      // A withdrawal nets against the same category bucket a deposit fills,
      // so the savings row (and the Budgets "saved" total) reflects what is
      // still in the envelope, not lifetime deposits.
      if (cat) byCat[cat] = (byCat[cat] || 0) - e.amount;
      if (e.sub) bySub[e.sub] = (bySub[e.sub] || 0) - e.amount;
      continue;
    }

    if (cls === "savings") {
      saved += e.amount;
      if (cat) byCat[cat] = (byCat[cat] || 0) + e.amount;
      if (e.sub) bySub[e.sub] = (bySub[e.sub] || 0) + e.amount;
      continue;
    }

    spent += e.amount;
    if (cat) byCat[cat] = (byCat[cat] || 0) + e.amount;
    if (e.sub) bySub[e.sub] = (bySub[e.sub] || 0) + e.amount;
  }

  const envelopeBudgets = Object.fromEntries(
    Object.entries(budgets).filter(([id]) => {
      const cat = index?.catById[id];
      // A retired envelope keeps its stored budget but must stop counting
      // toward the month's totals, or the budget line never comes back down.
      if (cat) return !isIncomeCategory(cat) && !isArchivedCategory(cat);

      return id !== "income";
    }),
  );
  const spendingBudgets = Object.fromEntries(
    Object.entries(envelopeBudgets).filter(([id]) => {
      const cat = index?.catById[id];
      if (cat) return isSpendingCategory(cat);

      return id !== "savings";
    }),
  );
  const totalBudget = Object.values(envelopeBudgets).reduce((s, v) => s + v, 0);
  const spendingBudget = Object.values(spendingBudgets).reduce((s, v) => s + v, 0);
  const byCatHeld = events ? holdsByCategory(events, key) : {};
  const totalHeld = events ? totalActiveHolds(events, key) : 0;
  const balance = walletBalance(opts?.balanceExpenses ?? expenses, wallet, index);
  const monthlyPool =
    wallet.fundingMode === "monthly" ? wallet.income + earned + withdrawn : earned + withdrawn;
  const remaining =
    wallet.fundingMode === "monthly" ? wallet.income + earned + withdrawn - spent - saved : balance;

  return {
    list: sortExpensesByDateDesc(list),
    spent,
    saved,
    earned,
    withdrawn,
    byCat,
    bySub,
    byCatHeld,
    totalHeld,
    totalBudget,
    spendingBudget,
    remaining,
    balance,
    fundingMode: wallet.fundingMode,
    monthlyPool,
  };
}
