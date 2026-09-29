import { planIsOverbudget, planMonthlyPlan, planMoney } from "./capitals";
import { CURRENT_MONTH_KEY, monthLabel, monthsWindow, roundMoney } from "./data";
import { mean } from "./stat-helpers";
import type { CategoryIndex } from "./categories";
import type { Piggy } from "./piggies";
import { classifyTx, isRecurring, recurringMonthlyEquivalent, recurringScheduleKey } from "./stats";
import type { CapitalPlan, Expense } from "./types";

type SavingsHeadline = {
  id: string;
  text: string;
  tone: "positive" | "warning";
};

type PiggyPace = {
  catId: string;
  /** Trailing monthly deposit rate, folding in active recurring pledges. */
  monthlyPace: number;
  /** ISO month (YYYY-MM) the target is projected to be hit, or null. */
  projectedCompletion: string | null;
  /** null when there is no target or no deadline to judge pace against. */
  onTrack: boolean | null;
  /** Monthly amount needed to hit the target by its deadline, or null. */
  requiredMonthly: number | null;
};

export type CapitalPace = {
  planId: string;
  name: string;
  glyph: string;
  /** Gross savings assigned to the plan, all time. */
  saved: number;
  /** What is left of that pot after payments — see `planUnspentTotal`. */
  unspent: number;
  /** Still to set aside once the pot is applied to the unpaid budget. */
  remainingNeed: number;
  /** Trailing monthly rate of assigned deposits, folding in recurring pledges. */
  monthlyPace: number;
  /** The Capitals Save/mo: need at the start of the viewed month ÷ months left to the target. */
  requiredMonthly: number | null;
  /** ISO month (YYYY-MM) the remaining need is projected to be covered, or null. */
  projectedCompletion: string | null;
  /** null when the plan has no budget or no target date to judge pace against. */
  onTrack: boolean | null;
  /** True once nothing is left to set aside for the plan. */
  funded: boolean;
  /** Paid line items already exceed the plan's budget. */
  overbudget: boolean;
};

type SavingsInsights = {
  /** Net savings (deposits − withdrawals) as a share of income over the window. */
  savingsRate: number;
  meanMonthly: number;
  /** Consecutive months (ending at the window's last month) with positive net saving. */
  currentStreak: number;
  bestMonth: { key: string; label: string; amount: number } | null;
  /** Net saving over the window across piggies and Capitals plans combined. */
  netFlow: number;
  /** The share of `netFlow` that landed in piggies (deposits with no plan). */
  piggyNetFlow: number;
  /** The share of `netFlow` assigned to Capitals plans. */
  capitalNetFlow: number;
  perPiggy: PiggyPace[];
  perPlan: CapitalPace[];
  headlines: SavingsHeadline[];
};

/** Shift a YYYY-MM key by a signed month delta. */
function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Whole months from one YYYY-MM key to another (may be negative). */
function monthsBetween(fromKey: string, toKey: string): number {
  const [fy, fm] = fromKey.split("-").map(Number);
  const [ty, tm] = toKey.split("-").map(Number);

  return (ty! - fy!) * 12 + (tm! - fm!);
}

/**
 * Net monthly deposits (savings − withdrawals) for one category across a
 * window of months, keyed by month. Also used by the Piggies view to draw
 * each card's contribution sparkline. Capital-assigned transactions are
 * excluded — they count toward the plan's pot, not the piggy.
 */
export function monthlyNetForCat(
  txns: Expense[],
  catId: string,
  index: CategoryIndex,
  months: { key: string }[],
): Map<string, number> {
  const byMonth = new Map(months.map((m) => [m.key, 0]));

  for (const e of txns) {
    if (e.capitalPlanId) continue;
    if (index.subById[e.sub]?.catId !== catId) continue;
    const monthKey = e.date.slice(0, 7);
    if (!byMonth.has(monthKey)) continue;

    const cls = classifyTx(e, index);
    if (cls === "savings") byMonth.set(monthKey, byMonth.get(monthKey)! + e.amount);
    else if (cls === "withdrawal") byMonth.set(monthKey, byMonth.get(monthKey)! - e.amount);
  }

  return byMonth;
}

/**
 * Net monthly savings assigned to one Capitals plan across a window of months.
 * The mirror of `monthlyNetForCat` on the other side of the split: this counts
 * only rows carrying the plan's `capitalPlanId`.
 */
function monthlyNetForPlan(
  txns: Expense[],
  planId: string,
  index: CategoryIndex,
  months: { key: string }[],
): Map<string, number> {
  const byMonth = new Map(months.map((m) => [m.key, 0]));

  for (const e of txns) {
    if (e.capitalPlanId !== planId) continue;
    const monthKey = e.date.slice(0, 7);
    if (!byMonth.has(monthKey)) continue;

    const cls = classifyTx(e, index);
    if (cls === "savings") byMonth.set(monthKey, byMonth.get(monthKey)! + e.amount);
    else if (cls === "withdrawal") byMonth.set(monthKey, byMonth.get(monthKey)! - e.amount);
  }

  return byMonth;
}

/**
 * Monthly equivalent of every still-active recurring deposit pledged to a
 * category, deduped by series so a 12-month-old standing order counts once,
 * not once per historical instance.
 */
function recurringPledgeForCat(txns: Expense[], catId: string, index: CategoryIndex): number {
  const seen = new Set<string>();
  let total = 0;

  for (const e of txns) {
    if (e.capitalPlanId) continue;
    if (classifyTx(e, index) !== "savings") continue;
    if (!isRecurring(e)) continue;
    if (index.subById[e.sub]?.catId !== catId) continue;

    const key = recurringScheduleKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    total += recurringMonthlyEquivalent(e.amount, e.recurring);
  }

  return total;
}

/** Recurring pledge equivalent for deposits assigned to one Capitals plan. */
function recurringPledgeForPlan(txns: Expense[], planId: string, index: CategoryIndex): number {
  const seen = new Set<string>();
  let total = 0;

  for (const e of txns) {
    if (e.capitalPlanId !== planId) continue;
    if (classifyTx(e, index) !== "savings") continue;
    if (!isRecurring(e)) continue;

    const key = recurringScheduleKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    total += recurringMonthlyEquivalent(e.amount, e.recurring);
  }

  return total;
}

/**
 * Pace, projection and on-track status for one piggy.
 *
 * `monthlyPace` resolves as the larger of (a) the trailing historical mean
 * over the window and (b) any active recurring pledge's monthly equivalent —
 * a standing order that only just started has thin history but a real,
 * known future rate, so relying on history alone would under-project it.
 */
function paceFor(
  piggy: Piggy,
  txns: Expense[],
  index: CategoryIndex,
  monthKey: string,
  windowMonths: { key: string }[],
): PiggyPace {
  const netByMonth = monthlyNetForCat(txns, piggy.catId, index, windowMonths);
  const historicalMean = mean([...netByMonth.values()]);
  const pledged = recurringPledgeForCat(txns, piggy.catId, index);
  const monthlyPace = roundMoney(Math.max(historicalMean, pledged));

  let projectedCompletion: string | null = null;
  if (piggy.target !== undefined && piggy.target > 0) {
    if (piggy.balance >= piggy.target) projectedCompletion = monthKey;
    else if (monthlyPace > 0) {
      const monthsNeeded = Math.ceil((piggy.target - piggy.balance) / monthlyPace);
      projectedCompletion = shiftMonthKey(monthKey, monthsNeeded);
    }
  }

  let onTrack: boolean | null = null;
  if (piggy.target !== undefined && piggy.target > 0 && piggy.deadline) {
    const deadlineMonth = piggy.deadline.slice(0, 7);
    onTrack =
      piggy.balance >= piggy.target ||
      (projectedCompletion !== null && projectedCompletion <= deadlineMonth);
  }

  let requiredMonthly: number | null = null;
  if (piggy.target !== undefined && piggy.target > 0 && piggy.deadline) {
    const remaining = piggy.target - piggy.balance;
    if (remaining <= 0) requiredMonthly = 0;
    else {
      const monthsLeft = monthsBetween(monthKey, piggy.deadline.slice(0, 7));
      requiredMonthly = monthsLeft > 0 ? roundMoney(remaining / monthsLeft) : null;
    }
  }

  return { catId: piggy.catId, monthlyPace, projectedCompletion, onTrack, requiredMonthly };
}

/**
 * Pace, projection and on-track status for one Capitals plan.
 *
 * The plan's goal is its remaining need — the unpaid part of the budget, less
 * whatever is still in the plan's pot. A plan reads as funded once its budget is
 * fully paid or fully saved for; money set aside and then spent on an item
 * counts once, not twice. Pace resolves like a piggy's: the larger of the
 * trailing window mean and any active recurring pledge, so a standing order
 * that only just started is not under-projected.
 */
function paceForPlan(
  plan: CapitalPlan,
  txns: Expense[],
  index: CategoryIndex,
  monthKey: string,
  windowMonths: { key: string }[],
): CapitalPace {
  const netByMonth = monthlyNetForPlan(txns, plan.id, index, windowMonths);
  const historicalMean = mean([...netByMonth.values()]);
  const pledged = recurringPledgeForPlan(txns, plan.id, index);
  const monthlyPace = roundMoney(Math.max(historicalMean, pledged));

  const { budget, saved, unspent, remainingNeed } = planMoney(plan, txns, index);
  const overbudget = planIsOverbudget(plan);
  const funded = budget > 0 && remainingNeed === 0;
  const targetMonth = plan.targetDate ? plan.targetDate.slice(0, 7) : null;

  let projectedCompletion: string | null = null;
  if (budget > 0) {
    if (remainingNeed === 0) projectedCompletion = monthKey;
    else if (monthlyPace > 0) {
      projectedCompletion = shiftMonthKey(monthKey, Math.ceil(remainingNeed / monthlyPace));
    }
  }

  /* The same figure as Save/mo on the Capitals card: need at the start of the
     viewed month over the months left, counting that month. */
  let requiredMonthly: number | null = null;
  if (budget > 0 && targetMonth) {
    if (remainingNeed === 0) requiredMonthly = 0;
    else {
      const [y, m] = monthKey.split("-").map(Number);
      const monthly = planMonthlyPlan(plan, new Date(y!, m! - 1, 1), txns, index);
      requiredMonthly = monthly ? roundMoney(monthly.perMonth) : null;
    }
  }

  const onTrack =
    budget > 0 && targetMonth
      ? funded || (projectedCompletion !== null && projectedCompletion <= targetMonth)
      : null;

  return {
    planId: plan.id,
    name: plan.name,
    glyph: plan.glyph,
    saved,
    unspent,
    remainingNeed,
    monthlyPace,
    requiredMonthly,
    projectedCompletion,
    onTrack,
    funded,
    overbudget,
  };
}

function buildHeadlines(
  piggies: Piggy[],
  perPiggy: PiggyPace[],
  perPlan: CapitalPace[],
  currentStreak: number,
  bestMonth: SavingsInsights["bestMonth"],
): SavingsHeadline[] {
  const headlines: SavingsHeadline[] = [];
  const paceById = new Map(perPiggy.map((p) => [p.catId, p]));

  if (currentStreak >= 2) {
    headlines.push({
      id: "streak",
      text: `${currentStreak} months in a row of net saving.`,
      tone: "positive",
    });
  }

  if (bestMonth && bestMonth.amount > 0) {
    headlines.push({
      id: "best-month",
      text: `Best month was ${bestMonth.label}, saving ${bestMonth.amount.toFixed(2)}.`,
      tone: "positive",
    });
  }

  const behind = piggies
    .filter((p) => paceById.get(p.catId)?.onTrack === false)
    .sort((a, b) => (b.target ?? 0) - (a.target ?? 0))[0];
  if (behind) {
    headlines.push({
      id: `behind-${behind.catId}`,
      text: `${behind.name} is behind pace for its ${behind.deadline?.slice(0, 7) ?? ""} deadline.`,
      tone: "warning",
    });
  }

  const onTrackAhead = piggies.find((p) => {
    const pace = paceById.get(p.catId);
    return pace?.onTrack === true && p.target !== undefined && p.balance < p.target;
  });
  if (onTrackAhead) {
    const pace = paceById.get(onTrackAhead.catId)!;
    headlines.push({
      id: `on-track-${onTrackAhead.catId}`,
      text: `${onTrackAhead.name} is on track${pace.projectedCompletion ? `, projected ${monthLabel(pace.projectedCompletion, false)}` : ""}.`,
      tone: "positive",
    });
  }

  headlines.push(...capitalHeadlines(perPlan));

  return headlines;
}

/**
 * One warning and one positive line about Capitals, at most, so a wallet with
 * a dozen plans does not bury its piggy callouts. The warning prefers the
 * plan that is furthest behind on money, since that is the hardest to catch up.
 */
function capitalHeadlines(perPlan: CapitalPace[]): SavingsHeadline[] {
  const headlines: SavingsHeadline[] = [];

  const overbudget = perPlan.find((p) => p.overbudget);
  const behind = perPlan
    .filter((p) => p.onTrack === false)
    .sort((a, b) => b.remainingNeed - a.remainingNeed)[0];

  if (behind) {
    headlines.push({
      id: `capital-behind-${behind.planId}`,
      text:
        behind.requiredMonthly !== null
          ? `${behind.name} needs ${behind.requiredMonthly.toFixed(2)} a month to be funded on time — you are setting aside ${behind.monthlyPace.toFixed(2)}.`
          : `${behind.name} still needs ${behind.remainingNeed.toFixed(2)} and its target date has passed.`,
      tone: "warning",
    });
  } else if (overbudget) {
    headlines.push({
      id: `capital-overbudget-${overbudget.planId}`,
      text: `${overbudget.name} is over its budget — paid items exceed what you planned.`,
      tone: "warning",
    });
  }

  const funded = perPlan.find((p) => p.funded && !p.overbudget);
  const onPace = perPlan.find((p) => p.onTrack === true && !p.funded);

  if (funded) {
    headlines.push({
      id: `capital-funded-${funded.planId}`,
      text: `${funded.name} is fully funded.`,
      tone: "positive",
    });
  } else if (onPace) {
    headlines.push({
      id: `capital-on-track-${onPace.planId}`,
      text: `${onPace.name} is on pace to be funded${onPace.projectedCompletion ? `, projected ${monthLabel(onPace.projectedCompletion, false)}` : ""}.`,
      tone: "positive",
    });
  }

  return headlines;
}

/**
 * Compute savings-behaviour insights for a window ending at `monthKey`.
 *
 * `savingsTxns` must already be filtered to savings deposits/withdrawals
 * (e.g. `useLedger().savingsTxns`); `allExpenses` is the full transaction set,
 * needed only to size `savingsRate` against income. `plans` is optional — pass
 * the wallet's Capitals plans to get per-plan pace and capital headlines.
 *
 * Money assigned to a Capitals plan is still money saved, so it counts toward
 * the wallet-wide figures (`netFlow`, `savingsRate`, streak, best month), with
 * `piggyNetFlow` / `capitalNetFlow` giving the split. Per-piggy pace stays
 * capital-free: an assigned deposit is progress on a plan, not on the piggy.
 */
export function computeSavingsInsights(
  savingsTxns: Expense[],
  allExpenses: Expense[],
  piggies: Piggy[],
  index: CategoryIndex,
  monthKey: string = CURRENT_MONTH_KEY,
  windowSize = 12,
  plans: CapitalPlan[] = [],
): SavingsInsights {
  const windowMonths = monthsWindow(monthKey, windowSize);
  const windowKeys = new Set(windowMonths.map((m) => m.key));

  const netByMonth = new Map(windowMonths.map((m) => [m.key, 0]));
  let piggyNet = 0;
  let capitalNet = 0;
  for (const e of savingsTxns) {
    const mo = e.date.slice(0, 7);
    if (!windowKeys.has(mo)) continue;
    const cls = classifyTx(e, index);
    if (cls !== "savings" && cls !== "withdrawal") continue;

    const signed = cls === "savings" ? e.amount : -e.amount;
    netByMonth.set(mo, netByMonth.get(mo)! + signed);
    if (e.capitalPlanId) capitalNet += signed;
    else piggyNet += signed;
  }

  const monthlyValues = windowMonths.map((m) => roundMoney(netByMonth.get(m.key) ?? 0));
  const meanMonthly = roundMoney(mean(monthlyValues));
  const netFlow = roundMoney(monthlyValues.reduce((s, v) => s + v, 0));

  let currentStreak = 0;
  for (let i = monthlyValues.length - 1; i >= 0; i--) {
    if (monthlyValues[i]! > 0) currentStreak++;
    else break;
  }

  let bestMonth: SavingsInsights["bestMonth"] = null;
  windowMonths.forEach((m, i) => {
    const amount = monthlyValues[i]!;
    if (!bestMonth || amount > bestMonth.amount) {
      bestMonth = { key: m.key, label: monthLabel(m.key, false), amount };
    }
  });

  let totalIncome = 0;
  for (const e of allExpenses) {
    const mo = e.date.slice(0, 7);
    if (!windowKeys.has(mo)) continue;
    if (classifyTx(e, index) === "income") totalIncome += e.amount;
  }
  // No income in the window means a savings rate has no denominator — 0% is
  // the honest answer, not NaN.
  const savingsRate = totalIncome > 0 ? roundMoney(netFlow / totalIncome) : 0;

  const perPiggy = piggies.map((p) => paceFor(p, savingsTxns, index, monthKey, windowMonths));
  const perPlan = plans.map((p) => paceForPlan(p, savingsTxns, index, monthKey, windowMonths));
  const headlines = buildHeadlines(piggies, perPiggy, perPlan, currentStreak, bestMonth);

  return {
    savingsRate,
    meanMonthly,
    currentStreak,
    bestMonth,
    netFlow,
    piggyNetFlow: roundMoney(piggyNet),
    capitalNetFlow: roundMoney(capitalNet),
    perPiggy,
    perPlan,
    headlines,
  };
}
