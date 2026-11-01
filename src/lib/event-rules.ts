/* Plain event rules shared by the zod schemas and the client (kept zod-free so
   the frontend bundle does not pull in zod). */

export const EVENT_CATEGORY_IDS = [
  "bill",
  "income",
  "savings",
  "renewal",
  "appointment",
  "personal",
  "custom",
] as const;

export const REPEAT_IDS = ["once", "daily", "weekly", "biweekly", "monthly", "yearly"] as const;
export type RepeatId = (typeof REPEAT_IDS)[number];

/** Days between the start of one occurrence and the start of the next. */
const REPEAT_STRIDE_DAYS: Record<RepeatId, number> = {
  once: Infinity,
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 28,
  yearly: 365,
};

/**
 * A repeat is allowed only when one occurrence finishes before the next starts.
 * `span` is the inclusive covered-day count, so the limit is the stride itself:
 * a 7-day span may repeat weekly (each run ends as the next begins, exactly as
 * an ordinary single-day event repeats daily), an 8-day span may not.
 */
export function isRepeatAllowedForSpan(repeat: RepeatId, span: number): boolean {
  return span <= REPEAT_STRIDE_DAYS[repeat];
}

/**
 * Inclusive covered-day count between two ISO dates (1 when they are equal).
 * An end before the start is treated as unset rather than a negative span.
 */
export function spanDaysBetween(startIso: string, endIso?: string | null): number {
  if (!endIso || endIso <= startIso) return 1;

  const day = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);

    return Date.UTC(y!, m! - 1, d!) / 86_400_000;
  };

  return day(endIso) - day(startIso) + 1;
}

export const LEAD_IDS = ["at", "15m", "30m", "1h", "6h", "12h", "1d", "2d"] as const;
export type LeadId = (typeof LEAD_IDS)[number];

/**
 * Reminder leads allowed for all-day events: the day of the event itself
 * (delivered at 09:00 in the user's timezone) plus whole-day offsets.
 */
const ALL_DAY_LEAD_IDS = ["at", "1d", "2d"] as const satisfies readonly LeadId[];

/** Reminder leads allowed for timed events. */
const TIMED_LEAD_IDS = LEAD_IDS;

/** Whether a reminder lead is valid for an all-day or timed event. */
export function isLeadAllowedForEvent(lead: LeadId, allDay: boolean): boolean {
  return allDay
    ? (ALL_DAY_LEAD_IDS as readonly string[]).includes(lead)
    : (TIMED_LEAD_IDS as readonly string[]).includes(lead);
}
