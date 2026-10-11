/**
 * Nudges: repeating reminders (drink water, stretch) with a daily count goal.
 *
 * The schedule is a fixed grid inside a daily window: slots start at the window's
 * opening time and repeat every `everyMin` until the window closes, so a late cron
 * pass never drags later slots with it. Progress is a count keyed to the local day,
 * so a new day reads as zero without anything being reset or deleted.
 */
import { zonedTodayIso } from "@/lib/recurring";
import { shiftIso } from "@/lib/schedule";
import { zonedLocalToUtcMs } from "@/lib/timezone";

export const NUDGE_MIN_EVERY = 30;
export const NUDGE_MAX_EVERY = 720;
/** The reminder cron ticks every 15 minutes, so a finer interval could not be honoured. */
export const NUDGE_EVERY_STEP = 15;
export const NUDGE_DEFAULT_WINDOW = { start: "08:00", end: "22:00" } as const;
/** A slot that is later than this when the cron reaches it is skipped rather than sent stale. */
export const NUDGE_STALE_MS = 30 * 60_000;

/** The timing half of a nudge: this is all the server needs to know to fire it. */
export type NudgeRule = { everyMin: number; windowStart: string; windowEnd: string };

export type Nudge = NudgeRule & {
  id: string;
  title: string;
  description: string;
  /** Daily goal as a count, with a free-text unit such as "glasses". */
  target: number;
  unit: string;
  /** Count logged on `day`; a different day means nothing has been logged yet today. */
  progress: { day: string; count: number };
  enabled: boolean;
  createdAt: string;
};

/** Minutes after midnight for an `HH:mm` string. */
export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];

  return h * 60 + m;
};

/** `HH:mm` for minutes after midnight. */
const toHhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Local calendar day and minute-of-day of an instant in an IANA zone. */
function localClock(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  return { day: zonedTodayIso(timeZone, new Date(ms)), minute: part("hour") * 60 + part("minute") };
}

/** The first slot strictly after `afterMs`: later today inside the window, else the next day's opening. */
export function nextNudgeAt(rule: NudgeRule, afterMs: number, timeZone: string): Date {
  const first = toMinutes(rule.windowStart);
  const last = toMinutes(rule.windowEnd);
  const { day, minute } = localClock(afterMs, timeZone);
  let slot =
    minute < first
      ? first
      : first + (Math.floor((minute - first) / rule.everyMin) + 1) * rule.everyMin;
  let at = day;

  /* A few passes cover a clock change landing between the arithmetic and the conversion. */
  for (let pass = 0; pass < 4; pass++) {
    if (slot > last) {
      at = shiftIso(at, 1);
      slot = first;
    }
    const ms = zonedLocalToUtcMs(at, toHhmm(slot), timeZone);
    if (ms > afterMs) return new Date(ms);
    slot += rule.everyMin;
  }

  return new Date(afterMs + rule.everyMin * 60_000);
}

/** The count logged today: yesterday's progress reads as zero. */
export const countToday = (nudge: Pick<Nudge, "progress">, today: string) =>
  nudge.progress.day === today ? nudge.progress.count : 0;

/** Whether today's goal has been reached. */
export const goalMet = (nudge: Pick<Nudge, "progress" | "target">, today: string) =>
  countToday(nudge, today) >= nudge.target;

/** "Every 30 min", "Every 2 h", "Every 1 h 30 min". */
export function everyLabel(everyMin: number): string {
  const h = Math.floor(everyMin / 60);
  const m = everyMin % 60;

  return `Every ${[h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ")}`;
}

/** Body text of the push: the goal, then the description when there is one. */
export function nudgeBody(nudge: Pick<Nudge, "target" | "unit" | "description">): string {
  const goal = `${nudge.target} ${nudge.unit}`.trim();

  return nudge.description.trim() ? `${goal} today · ${nudge.description.trim()}` : `${goal} today`;
}
