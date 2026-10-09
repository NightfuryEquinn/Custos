/**
 * Daily routines: recurrence, streaks and points as pure functions.
 *
 * Period keys are calendar strings, never timestamps, so a timezone change
 * cannot relabel history: a day is `YYYY-MM-DD`, a week is the `YYYY-MM-DD` of
 * its Monday (weeks run Monday-Sunday). Points and streaks are always derived
 * from completions; nothing here stores a counter.
 */
import { shiftIso } from "@/lib/schedule";
import { zonedLocalToUtcMs } from "@/lib/timezone";

export const DAILY_POINTS = 10;

export type DailyKind = "daily" | "weekdays" | "weekly";

/** One recurrence rule, in force from `from` until the next entry. Weekdays are 0 = Monday … 6 = Sunday. */
export type DailySchedule = { from: string; kind: DailyKind; weekdays?: number[] };

export type DailyRoutine = {
  id: string;
  title: string;
  notes: string;
  /** Sorted by `from`; earlier entries stay in force for the periods they covered. */
  schedule: DailySchedule[];
  /** Last day the routine was active; set when archived. */
  archivedOn?: string;
  createdAt: string;
};

/** A checkbox state for one routine in one period. `id` is `${routineId}:${period}`. */
export type DailyCompletion = {
  id: string;
  routineId: string;
  period: string;
  done: boolean;
  at: string;
};

/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/** The Monday of the week containing `day`. */
export const weekStart = (day: string) => shiftIso(day, -weekdayOf(day));

/** The period key `day` falls in under a recurrence kind. */
export const periodOf = (kind: DailyKind, day: string) =>
  kind === "weekly" ? weekStart(day) : day;

/** The rule in force on `day`, or null before the routine begins. */
export function scheduleAt(history: DailySchedule[], day: string): DailySchedule | null {
  let hit: DailySchedule | null = null;
  for (const entry of history) {
    if (entry.from > day) break;
    hit = entry;
  }
  return hit;
}

/** Whether `day` starts an occurrence under `rule` (weekly occurrences start on Monday). */
function emits(rule: DailySchedule, day: string): boolean {
  if (rule.kind === "daily") return true;
  if (rule.kind === "weekdays") return !!rule.weekdays?.includes(weekdayOf(day));
  return weekdayOf(day) === 0;
}

/** The period that is due on `today`, or null when nothing is (not scheduled, not started, archived). */
export function currentPeriod(routine: DailyRoutine, today: string): string | null {
  if (routine.archivedOn) return null;
  const rule = scheduleAt(routine.schedule, today);
  if (!rule) return null;
  if (rule.kind === "weekly") return weekStart(today);
  return emits(rule, today) ? today : null;
}

/** Every occurrence key from the routine's start through `asOf`, ascending. */
function occurrencesUntil(history: DailySchedule[], asOf: string): string[] {
  const keys: string[] = [];
  // ponytail: day-by-day walk, fine for years of history across tens of routines.
  for (let day = history[0]?.from; day && day <= asOf; day = shiftIso(day, 1)) {
    if (emits(scheduleAt(history, day)!, day)) keys.push(day);
  }
  return keys;
}

/** An occurrence is open until its deadline passes: the day itself, or the week's Sunday. */
const isOpen = (history: DailySchedule[], key: string, asOf: string) =>
  scheduleAt(history, key)!.kind === "weekly" ? asOf <= shiftIso(key, 6) : key === asOf;

/**
 * Consecutive completed occurrences. Unscheduled days never break a streak, an
 * occurrence that is still open is not yet a miss, and an archived routine is
 * evaluated as of its archive day.
 */
export function computeStreak(routine: DailyRoutine, done: Set<string>, today: string) {
  const asOf = routine.archivedOn ?? today;
  let current = 0;
  let best = 0;
  for (const key of occurrencesUntil(routine.schedule, asOf)) {
    if (done.has(key)) best = Math.max(best, ++current);
    else if (!isOpen(routine.schedule, key, asOf)) current = 0;
  }
  return { current, best };
}

/** Streaks count weeks for a weekly routine and days otherwise. */
export function streakUnit(routine: DailyRoutine, today: string): "day" | "week" {
  const rule = scheduleAt(routine.schedule, today) ?? routine.schedule.at(-1);
  return rule?.kind === "weekly" ? "week" : "day";
}

/** Lifetime points: one fixed award per completed occurrence, so undo/recheck cannot inflate it. */
export const points = (completions: DailyCompletion[]) =>
  DAILY_POINTS * completions.filter((c) => c.done).length;

/** A routine that starts in the current eligible period, so no history is owed. */
export function newRoutine(
  input: { title: string; notes?: string; kind: DailyKind; weekdays?: number[] },
  today: string,
  nowIso: string,
): Omit<DailyRoutine, "id"> {
  const rule: DailySchedule = {
    from: periodOf(input.kind, today),
    kind: input.kind,
    ...(input.kind === "weekdays" ? { weekdays: input.weekdays } : {}),
  };
  return { title: input.title, notes: input.notes ?? "", schedule: [rule], createdAt: nowIso };
}

/**
 * Change the recurrence. It takes effect after the current period (tomorrow, or
 * next Monday when weekly is involved) and earlier periods keep their rule. A
 * routine with nothing completed has no history to preserve, so it is rewritten.
 */
export function editSchedule(
  history: DailySchedule[],
  next: Omit<DailySchedule, "from">,
  today: string,
  hasCompletions: boolean,
): DailySchedule[] {
  if (!hasCompletions) return [{ from: periodOf(next.kind, today), ...next }];

  const kept = history.filter((entry) => entry.from <= today); // drops a pending future change
  const current = scheduleAt(kept, today);
  if (current && current.kind === next.kind && String(current.weekdays) === String(next.weekdays)) {
    return kept;
  }
  const weeklyInvolved = current?.kind === "weekly" || next.kind === "weekly";
  const from = weeklyInvolved ? shiftIso(weekStart(today), 7) : shiftIso(today, 1);
  return [...kept, { from, ...next }];
}

/** Milliseconds from `nowMs` until the first instant of the day after `today` in `timeZone`. */
export const msUntilNextDay = (today: string, timeZone: string, nowMs: number) =>
  zonedLocalToUtcMs(shiftIso(today, 1), "00:00", timeZone) - nowMs;

/** One checklist row: a routine, the period due now, and where it stands. */
export type DailyRow = {
  routine: DailyRoutine;
  period: string;
  done: boolean;
  streak: { current: number; best: number };
  unit: "day" | "week";
};

/**
 * The routines due on `today` for one tab: Today holds daily and selected-weekday
 * routines, This week holds weekly ones. Incomplete rows come first and completed
 * rows stay visible beneath them.
 */
export function dueRows(
  routines: DailyRoutine[],
  completions: DailyCompletion[],
  today: string,
  tab: "today" | "week",
): DailyRow[] {
  const doneBy = new Map<string, Set<string>>();
  for (const c of completions) {
    if (c.done) doneBy.set(c.routineId, (doneBy.get(c.routineId) ?? new Set()).add(c.period));
  }
  const rows: DailyRow[] = [];
  for (const routine of routines) {
    const period = currentPeriod(routine, today);
    const kind = scheduleAt(routine.schedule, today)?.kind;
    if (!period || !kind || (kind === "weekly") !== (tab === "week")) continue;
    const doneSet = doneBy.get(routine.id) ?? new Set<string>();
    rows.push({
      routine,
      period,
      done: doneSet.has(period),
      streak: computeStreak(routine, doneSet, today),
      unit: streakUnit(routine, today),
    });
  }

  return rows.sort(
    (a, b) =>
      Number(a.done) - Number(b.done) || a.routine.createdAt.localeCompare(b.routine.createdAt),
  );
}

/**
 * Active routines with nothing due today (a weekday routine on an off day, or one that
 * starts later). Listing them keeps every routine reachable for editing and archiving.
 */
export const idleRoutines = (routines: DailyRoutine[], today: string) =>
  routines.filter((r) => !r.archivedOn && currentPeriod(r, today) === null);

/** How many of a tab's rows are done. */
export const progressOf = (rows: DailyRow[]) => ({
  done: rows.filter((r) => r.done).length,
  total: rows.length,
});
