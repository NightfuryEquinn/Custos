import { CAPITAL_TEMPLATES, type CapitalTemplate } from "@/frontend/lib/capitalTemplates";
import { slugId, type CategoryIndex } from "@/frontend/lib/categories";
import { roundMoney } from "@/frontend/lib/data";
import { classifyTx } from "@/frontend/lib/stats";
import type { CapitalItem, CapitalPlan, CapitalTemplateId, Expense } from "@/frontend/lib/types";

/*
 * Capitals money math — every figure is derived, nothing is persisted.
 *
 * A plan has a budget (B), payments recorded on its line items (P), and a pot of
 * savings deposits assigned to it (S). Line items carry no funding source, so
 * Capitals assumes payments are drawn from the pot first and from other money
 * only once the pot is empty:
 *
 *   saved       S = deposits − withdrawals carrying this plan's id
 *   unspent     max(0, S − P)              what is still in the pot
 *   ofPocket    max(0, P − S)              payments the pot did not cover
 *   outstanding max(0, B − P)              budgeted cost not yet paid
 *   need        max(0, outstanding − unspent)
 *
 * `need` collapses to (B − S) while the pot still covers every payment, and to
 * (B − P) once payments have emptied it, so money that was set aside and then
 * spent on an item is only ever counted once. The old formula was
 * (B − P − S), which counted it twice and under-stated what was left to save.
 *
 * The draw-down is implicit: paying an item is NOT recorded as an assigned
 * withdrawal, and must not be, or the pot would be drawn down twice — once by
 * the withdrawal and once by the payment. See `logCapitalItem` in LedgerApp.
 *
 * Save/mo is `need at the start of this month ÷ months left` (see
 * `planMonthlyPlan`), so depositing mid-month lowers what is left to deposit
 * this month rather than shrinking the monthly rate.
 */

/** Sum of every item's estimated cost. */
export function planTotal(plan: CapitalPlan): number {
  return plan.items.reduce((s, i) => s + i.estimatedCost, 0);
}

/** Sum of actual cost for items already marked paid (falls back to estimate). */
export function planPaidTotal(plan: CapitalPlan): number {
  return plan.items
    .filter((i) => i.paid)
    .reduce((s, i) => s + (i.actualCost ?? i.estimatedCost), 0);
}

/** Sum of estimated cost for items not yet paid. */
export function planUnpaidTotal(plan: CapitalPlan): number {
  return plan.items.filter((i) => !i.paid).reduce((s, i) => s + i.estimatedCost, 0);
}

/** Budget as the user typed it, treating missing as 0. Prefer `planEffectiveBudget`. */
export function planBudget(plan: CapitalPlan): number {
  return plan.initialBudget ?? 0;
}

/**
 * The budget every other figure is measured against: the typed budget, or the
 * sum of item estimates when none was typed. Without the fallback a plan with
 * items but no budget reads as a 0 budget, which makes any payment "Overpaid".
 *
 * A derived budget moves when item costs are edited, so the card labels it as
 * coming from estimates rather than showing a number that shifts unexplained.
 */
export function planEffectiveBudget(plan: CapitalPlan): number {
  const typed = planBudget(plan);

  return typed > 0 ? typed : planTotal(plan);
}

/** True when paid items exceed the budget. A plan with no budget is never over it. */
export function planIsOverbudget(plan: CapitalPlan): boolean {
  const budget = planEffectiveBudget(plan);

  return budget > 0 && planPaidTotal(plan) > budget;
}

/**
 * Gross savings assigned to a plan: deposits minus withdrawals carrying this
 * plan's id, over all time. It grows as deposits land and knows nothing about
 * what has since been spent — `planUnspentTotal` is the balance after payments.
 *
 * A row could carry a `capitalPlanId` on a withdrawal — the "Allocate to" picker
 * is gated to expenses, so not one it creates. If such a row exists alongside a
 * paid item, the pot is drawn down twice: once by the withdrawal, once by the
 * payment. Rare enough to document rather than code around.
 */
export function planSavedTotal(plan: CapitalPlan, txns: Expense[], index?: CategoryIndex): number {
  let total = 0;

  for (const e of txns) {
    if (e.capitalPlanId !== plan.id) continue;
    const cls = classifyTx(e, index);
    if (cls !== "savings" && cls !== "withdrawal") continue;
    total += cls === "savings" ? e.amount : -e.amount;
  }

  return roundMoney(total);
}

/**
 * Strip a `capitalPlanId` that no longer resolves to a plan.
 *
 * A dangling id is skipped by its piggy — the exclusion tests are truthiness
 * checks — and claimed by no plan, whose inclusion tests are id equality, so the
 * deposit counts nowhere at all. Releasing it puts the money back in its savings
 * envelope. Deleting a plan now clears these server-side; this heals ids left
 * behind by deletes that predate that, or by a delete on another device.
 *
 * Returns the input array unchanged when nothing is orphaned, so callers keep
 * their memo identity.
 */
export function releaseOrphanedPlanRefs<T extends Expense>(txns: T[], plans: CapitalPlan[]): T[] {
  const live = new Set(plans.map((p) => p.id));
  if (!txns.some((e) => e.capitalPlanId && !live.has(e.capitalPlanId))) return txns;

  return txns.map((e) =>
    e.capitalPlanId && !live.has(e.capitalPlanId) ? { ...e, capitalPlanId: undefined } : e,
  );
}

/** Budgeted cost not yet paid: max(0, budget − paid). */
export function planOutstandingCost(plan: CapitalPlan): number {
  return roundMoney(Math.max(0, planEffectiveBudget(plan) - planPaidTotal(plan)));
}

type PlanMoney = {
  /** Budget every other figure is measured against — typed, or from estimates. */
  budget: number;
  /** Sum of paid items, at actual cost where known. */
  paid: number;
  /** Gross savings assigned to the plan, all time. */
  saved: number;
  /** What is left of that pot after payments. */
  unspent: number;
  /** Payments the pot did not cover. */
  outOfPocket: number;
  /** Budgeted cost not yet paid. */
  outstanding: number;
  /** Still to set aside once the pot is applied to the unpaid budget. */
  remainingNeed: number;
};

/**
 * Every money figure for one plan, from a single pass over `txns`. Prefer this
 * when a caller needs more than one figure — the helpers around it are thin
 * reads of this, so the two can never disagree.
 */
export function planMoney(
  plan: CapitalPlan,
  txns: Expense[] = [],
  index?: CategoryIndex,
): PlanMoney {
  const budget = planEffectiveBudget(plan);
  const paid = planPaidTotal(plan);
  const saved = txns.length ? planSavedTotal(plan, txns, index) : 0;
  const unspent = roundMoney(Math.max(0, saved - paid));
  const outOfPocket = roundMoney(Math.max(0, paid - saved));
  const outstanding = planOutstandingCost(plan);

  return {
    budget: roundMoney(budget),
    paid: roundMoney(paid),
    saved,
    unspent,
    outOfPocket,
    outstanding,
    remainingNeed: roundMoney(Math.max(0, outstanding - unspent)),
  };
}

/**
 * What is left in the plan's pot: max(0, saved − paid). Paying a line item draws
 * this down, because money you set aside and then spent cannot also be sitting
 * there waiting for the rest of the budget.
 */
export function planUnspentTotal(
  plan: CapitalPlan,
  txns: Expense[],
  index?: CategoryIndex,
): number {
  return planMoney(plan, txns, index).unspent;
}

/** Payments the plan's pot did not cover: max(0, paid − saved). */
export function planOutOfPocket(plan: CapitalPlan, txns: Expense[], index?: CategoryIndex): number {
  return planMoney(plan, txns, index).outOfPocket;
}

/**
 * Money still to set aside: what is left of the budget after payments, minus
 * whatever is still in the pot — max(0, max(0, B − P) − max(0, S − P)).
 *
 * It collapses to (budget − saved) while the pot still covers every payment, and
 * to (budget − paid) once payments have emptied it, so money that was set aside
 * and then spent on an item is only ever counted once.
 */
export function planRemainingNeed(
  plan: CapitalPlan,
  txns: Expense[] = [],
  index?: CategoryIndex,
): number {
  return planMoney(plan, txns, index).remainingNeed;
}

/**
 * Paid ÷ budget for the card's "% paid" tag.
 * Null when there is no budget yet.
 */
export function planBudgetProgress(plan: CapitalPlan): number | null {
  const budget = planEffectiveBudget(plan);

  if (budget <= 0) return null;

  return planPaidTotal(plan) / budget;
}

/** YYYY-MM key for a Date. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Whole months from one YYYY-MM key to another (may be negative). */
function monthsBetween(fromKey: string, toKey: string): number {
  const [fy, fm] = fromKey.split("-").map(Number);
  const [ty, tm] = toKey.split("-").map(Number);

  return (ty! - fy!) * 12 + (tm! - fm!);
}

/**
 * Whole calendar months until the plan's target month.
 * Returns null when there is no target or the target month is in the past.
 * Minimum 1 when the target is this month or later.
 */
export function planMonthsUntilTarget(plan: CapitalPlan, today: Date = new Date()): number | null {
  if (!plan.targetDate) return null;

  const diff = monthsBetween(monthKey(today), plan.targetDate.slice(0, 7));

  if (diff < 0) return null;

  return Math.max(1, diff);
}

/** True when the plan has a target date in the current month or later. */
export function planIsUpcoming(plan: CapitalPlan, today: Date = new Date()): boolean {
  return planMonthsUntilTarget(plan, today) !== null;
}

/**
 * What to set aside each month, and how much of this month's share is still
 * to deposit. Null when there is no budget to save toward, when the plan is
 * overbudget, or when months cannot be computed (no/past target).
 *
 * `perMonth` is measured against the need at the START of this month: what is
 * left to save now, plus what this month's deposits already took off it. That
 * keeps it steady all month — a deposit lowers `leftThisMonth`, not the rate.
 * Only deposits still in the pot are added back (`unspent`); money already
 * spent on an item reduced `outstanding` and must not be counted again.
 */
export function planMonthlyPlan(
  plan: CapitalPlan,
  today: Date = new Date(),
  txns: Expense[] = [],
  index?: CategoryIndex,
): { perMonth: number; leftThisMonth: number } | null {
  if (planEffectiveBudget(plan) <= 0) return null;
  if (planIsOverbudget(plan)) return null;

  const months = planMonthsUntilTarget(plan, today);

  if (months === null) return null;

  const { remainingNeed, unspent } = planMoney(plan, txns, index);
  const thisMonth = monthKey(today);
  let net = 0;

  for (const e of txns) {
    if (e.capitalPlanId !== plan.id || e.date.slice(0, 7) !== thisMonth) continue;
    const cls = classifyTx(e, index);
    if (cls === "savings") net += e.amount;
    else if (cls === "withdrawal") net -= e.amount;
  }

  const contributed = Math.min(Math.max(0, net), unspent);
  const perMonth = (remainingNeed + contributed) / months;

  return { perMonth, leftThisMonth: Math.max(0, perMonth - contributed) };
}

/** Monthly amount to set aside — see `planMonthlyPlan`. */
export function planMonthlySave(
  plan: CapitalPlan,
  today: Date = new Date(),
  txns: Expense[] = [],
  index?: CategoryIndex,
): number | null {
  return planMonthlyPlan(plan, today, txns, index)?.perMonth ?? null;
}

/** Sum of monthly save across plans (overbudget plans contribute 0). */
export function plansTotalMonthlySave(
  plans: CapitalPlan[],
  today: Date = new Date(),
  txns: Expense[] = [],
  index?: CategoryIndex,
): number {
  return plans.reduce((sum, p) => {
    const monthly = planMonthlySave(p, today, txns, index);

    return sum + (monthly ?? 0);
  }, 0);
}

/** Fraction of items marked paid, or null when the plan has no items yet. */
export function planProgress(plan: CapitalPlan): number | null {
  if (!plan.items.length) return null;
  return plan.items.filter((i) => i.paid).length / plan.items.length;
}

function itemId(name: string, existing: CapitalItem[]) {
  const base = slugId("item", name);
  if (!existing.some((i) => i.id === base)) return base;
  return `${base}_${Date.now().toString(36).slice(-4)}`;
}

/** Build a new item list for a fresh item name, avoiding id collisions. */
export function newCapitalItem(name: string, existing: CapitalItem[]): CapitalItem {
  return {
    id: itemId(name, existing),
    name,
    estimatedCost: 0,
    paid: false,
  };
}

/** Prefill a fresh plan's items from a built-in template. Names only — fully editable after. */
export function instantiateFromTemplate(templateId: CapitalTemplateId): CapitalItem[] {
  const template: CapitalTemplate | undefined = CAPITAL_TEMPLATES.find((t) => t.id === templateId);
  if (!template) return [];

  const items: CapitalItem[] = [];
  for (const name of template.items) {
    items.push(newCapitalItem(name, items));
  }
  return items;
}
