import { TODAY_ISO, scheduleForMonth } from "@/frontend/lib/data";
import type { LedgerEvent } from "@/frontend/lib/types";

/** Any schedule event can reserve a budget envelope hold. */
function isHoldEligibleEvent(_ev: Pick<LedgerEvent, "catId">): boolean {
  return true;
}

/** Coerce a hold amount to a finite positive number, or 0. */
function holdAmountValue(amount: unknown): number {
  const n = typeof amount === "number" ? amount : Number(amount);

  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Whether the event has an active encrypted hold configuration. */
function hasBudgetHoldConfig(ev: LedgerEvent): boolean {
  return Boolean(
    ev.budgetHoldEnabled && holdAmountValue(ev.budgetHoldAmount) > 0 && ev.budgetHoldCategoryId,
  );
}

/** True when a hold was released for this calendar occurrence. */
export function isHoldReleased(ev: LedgerEvent, occurrenceIso: string): boolean {
  if (ev.budgetHoldReleasedDates?.includes(occurrenceIso)) return true;

  if (ev.repeat === "once" && ev.expenseId && occurrenceIso === ev.date) {
    return true;
  }

  return false;
}

/** True when this occurrence still reserves budget. A passed occurrence auto-releases. */
export function isActiveHoldOccurrence(ev: LedgerEvent, occurrenceIso: string): boolean {
  if (!isHoldEligibleEvent(ev) || !hasBudgetHoldConfig(ev)) return false;
  if (occurrenceIso < TODAY_ISO) return false;

  return !isHoldReleased(ev, occurrenceIso);
}

/** Sum active holds per category for the month's occurrences from today onward. */
export function holdsByCategory(events: LedgerEvent[], monthKey: string): Record<string, number> {
  const holds: Record<string, number> = {};

  for (const { iso, ev } of scheduleForMonth(events, monthKey)) {
    if (!isActiveHoldOccurrence(ev, iso)) continue;

    const catId = ev.budgetHoldCategoryId!;
    holds[catId] = (holds[catId] || 0) + holdAmountValue(ev.budgetHoldAmount);
  }

  return holds;
}

/** Return event with the occurrence hold marked released. */
export function releaseHoldForOccurrence(ev: LedgerEvent, occurrenceIso: string): LedgerEvent {
  if (!hasBudgetHoldConfig(ev)) return ev;

  const released = ev.budgetHoldReleasedDates ?? [];
  if (released.includes(occurrenceIso)) return ev;

  return {
    ...ev,
    budgetHoldReleasedDates: [...released, occurrenceIso],
  };
}

/** Re-open a hold after a linked payment is deleted. */
export function restoreHoldForOccurrence(ev: LedgerEvent, occurrenceIso: string): LedgerEvent {
  const released = (ev.budgetHoldReleasedDates ?? []).filter((d) => d !== occurrenceIso);
  const next: LedgerEvent = {
    ...ev,
    expenseId: "",
  };

  if (released.length) {
    next.budgetHoldReleasedDates = released;
  } else {
    delete next.budgetHoldReleasedDates;
  }

  return next;
}
