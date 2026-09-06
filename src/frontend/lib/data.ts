import { DEFAULT_CATEGORIES } from "@/schemas/category";
import { spanDaysBetween } from "@/schemas/common";
import { occurrenceStartFor, spanDays } from "@/lib/schedule";
import type { MonthEntry } from "./types";

const CURRENCY = { code: "MYR", symbol: "RM", label: "Malaysian Ringgit" };

export const CURRENCIES = [
  { code: "AED", symbol: "د.إ", label: "UAE Dirham" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar" },
  { code: "BDT", symbol: "৳", label: "Bangladeshi Taka" },
  { code: "BND", symbol: "B$", label: "Brunei Dollar" },
  { code: "BRL", symbol: "R$", label: "Brazilian Real" },
  { code: "CAD", symbol: "C$", label: "Canadian Dollar" },
  { code: "CHF", symbol: "CHF", label: "Swiss Franc" },
  { code: "CNY", symbol: "¥", label: "Chinese Yuan" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "GBP", symbol: "£", label: "British Pound" },
  { code: "HKD", symbol: "HK$", label: "Hong Kong Dollar" },
  { code: "IDR", symbol: "Rp", label: "Indonesian Rupiah" },
  { code: "INR", symbol: "₹", label: "Indian Rupee" },
  { code: "JPY", symbol: "¥", label: "Japanese Yen" },
  { code: "KRW", symbol: "₩", label: "South Korean Won" },
  { code: "MXN", symbol: "MX$", label: "Mexican Peso" },
  { code: "MYR", symbol: "RM", label: "Malaysian Ringgit" },
  { code: "NZD", symbol: "NZ$", label: "New Zealand Dollar" },
  { code: "PHP", symbol: "₱", label: "Philippine Peso" },
  { code: "PKR", symbol: "₨", label: "Pakistani Rupee" },
  { code: "SAR", symbol: "﷼", label: "Saudi Riyal" },
  { code: "SEK", symbol: "kr", label: "Swedish Krona" },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar" },
  { code: "THB", symbol: "฿", label: "Thai Baht" },
  { code: "TRY", symbol: "₺", label: "Turkish Lira" },
  { code: "TWD", symbol: "NT$", label: "New Taiwan Dollar" },
  { code: "USD", symbol: "$", label: "US Dollar" },
  { code: "VND", symbol: "₫", label: "Vietnamese Dong" },
  { code: "ZAR", symbol: "R", label: "South African Rand" },
] as const;

const CURRENCY_BY_CODE = Object.fromEntries(CURRENCIES.map((c) => [c.code, c]));

/** Resolve currency metadata by ISO code, falling back to MYR. */
export function getCurrency(code?: string) {
  return CURRENCY_BY_CODE[code ?? CURRENCY.code] ?? CURRENCY;
}

/** Builtin subcategory lookup used when no live CategoryIndex is available. */
export const SUB_BY_ID: Record<string, { id: string; name: string; catId: string; color: string }> =
  {};
DEFAULT_CATEGORIES.forEach((c) =>
  c.subs.forEach((s) => {
    SUB_BY_ID[s.id] = { ...s, catId: c.id, color: c.color };
  }),
);

/** Zero-pad a number to two digits. */
export function pad(n: number) {
  return String(n).padStart(2, "0");
}

export const MIN_MONTH_KEY = "2020-01";

const _now = new Date();
const CURRENT_YEAR = _now.getFullYear();
const CURRENT_MONTH = _now.getMonth();
export const CURRENT_DAY = _now.getDate();
export const CURRENT_MONTH_KEY = `${CURRENT_YEAR}-${pad(CURRENT_MONTH + 1)}`;
export const TODAY_ISO = `${CURRENT_MONTH_KEY}-${pad(CURRENT_DAY)}`;
export const MAX_MONTH_KEY = `${CURRENT_YEAR + 10}-${pad(CURRENT_MONTH + 1)}`;

/** Build month entries from fromKey through toKey inclusive. */
function buildMonths(fromKey: string, toKey: string): MonthEntry[] {
  const [fromY, fromM] = fromKey.split("-").map(Number);
  const [toY, toM] = toKey.split("-").map(Number);
  const out: MonthEntry[] = [];
  let y = fromY!;
  let m = fromM! - 1;
  const end = new Date(toY!, toM! - 1, 1).getTime();

  while (new Date(y, m, 1).getTime() <= end) {
    out.push({ key: `${y}-${pad(m + 1)}`, year: y, m });
    m += 1;

    if (m > 11) {
      m = 0;
      y += 1;
    }
  }

  return out;
}

/** Navigable months, oldest → newest (Jan 2020 through same month 10 years ahead). */
export const MONTHS = buildMonths(MIN_MONTH_KEY, MAX_MONTH_KEY);

/** Clamp a month key into the navigable range. */
export function clampMonthKey(key?: string | null) {
  const month = key || CURRENT_MONTH_KEY;

  if (month < MIN_MONTH_KEY) return MIN_MONTH_KEY;
  if (month > MAX_MONTH_KEY) return MAX_MONTH_KEY;

  return month;
}

/** Min/max year-month bounds for the month picker. */
export function monthRangeBounds() {
  const [minY, minM] = MIN_MONTH_KEY.split("-").map(Number);
  const [maxY, maxM] = MAX_MONTH_KEY.split("-").map(Number);

  return { minY, minM, maxY, maxM };
}

/** Last N navigable months ending at anchor (for charts). */
export function monthsWindow(anchorKey: string, size = 6) {
  const idx = MONTHS.findIndex((m) => m.key === anchorKey);

  if (idx < 0) return MONTHS.slice(-size);

  return MONTHS.slice(Math.max(0, idx - size + 1), idx + 1);
}

// ── Schedule: event types, recurrence, reminders ────────────────────

export const EVENT_CATS = [
  { id: "bill", name: "Bill / Payment", color: "#4f8a7b", glyph: "🧾" },
  { id: "income", name: "Income", color: "#6f8b6f", glyph: "💵" },
  { id: "savings", name: "Savings", color: "#7a6fa5", glyph: "🐷" },
  { id: "renewal", name: "Renewal", color: "#5b7a8a", glyph: "🔄" },
  { id: "appointment", name: "Appointment", color: "#4a6fa5", glyph: "📅" },
  { id: "personal", name: "Personal", color: "#a06f95", glyph: "📌" },
  { id: "custom", name: "Custom", color: "#8a7355", glyph: "✨" },
];

const EVENT_CAT_BY_ID = Object.fromEntries(EVENT_CATS.map((c) => [c.id, c]));

/** Resolve display meta for an event type, including custom label/glyph. */
export function eventCatMeta(ev: { catId: string; customLabel?: string; customGlyph?: string }) {
  /* EVENT_CATS always has a "custom" entry (defined above), so this fallback never misses. */
  const base = (EVENT_CAT_BY_ID[ev.catId] ?? EVENT_CAT_BY_ID.custom)!;

  if (ev.catId === "custom") {
    return {
      ...base,
      name: ev.customLabel?.trim() || base.name,
      glyph: ev.customGlyph?.trim() || base.glyph,
    };
  }

  return base;
}

export const REPEATS = [
  { id: "once", label: "One-time", adj: "Once" },
  { id: "daily", label: "Daily", adj: "Daily" },
  { id: "weekly", label: "Weekly", adj: "Weekly" },
  { id: "biweekly", label: "Biweekly", adj: "Biweekly" },
  { id: "monthly", label: "Monthly", adj: "Monthly" },
  { id: "yearly", label: "Yearly", adj: "Yearly" },
];

const REPEAT_BY_ID = Object.fromEntries(REPEATS.map((r) => [r.id, r]));

const LEAD_TIMES = [
  { id: "at", label: "At time of event", short: "on time" },
  { id: "15m", label: "15 minutes before", short: "15 min before" },
  { id: "30m", label: "30 minutes before", short: "30 min before" },
  { id: "1h", label: "1 hour before", short: "1 hr before" },
  { id: "6h", label: "6 hours before", short: "6 hr before" },
  { id: "12h", label: "12 hours before", short: "12 hr before" },
  { id: "1d", label: "1 day before", short: "1 day before" },
  { id: "2d", label: "2 days before", short: "2 days before" },
] as const;

const LEAD_BY_ID = Object.fromEntries(LEAD_TIMES.map((l) => [l.id, l]));

const ALL_DAY_LEAD_SET = new Set(["at", "1d", "2d"]);

/**
 * All-day events have no clock time, so "at" means the morning of the event
 * itself — the server sends it at 09:00 in the account timezone.
 */
const ALL_DAY_AT_LEAD = {
  id: "at",
  label: "On the day (9:00 AM)",
  short: "on the day",
} as const;

/** Reminder dropdown options for the event modal. */
export function leadTimesForEvent(allDay: boolean) {
  if (!allDay) return LEAD_TIMES;

  return LEAD_TIMES.filter((l) => ALL_DAY_LEAD_SET.has(l.id)).map((l) =>
    l.id === "at" ? ALL_DAY_AT_LEAD : l,
  );
}

/**
 * Sort events on the same day: all-day first, then earliest time, then title.
 * A day the event merely runs through (`dayIndex > 0`) has no clock time of its
 * own, so it ranks with the all-day group.
 */
function compareEventsByEarliest(
  a: { allDay?: boolean; time?: string | null; title?: string; dayIndex?: number },
  b: { allDay?: boolean; time?: string | null; title?: string; dayIndex?: number },
): number {
  const timed = (ev: typeof a) => !ev.allDay && !ev.dayIndex;
  const ra = timed(a) ? 1 : 0;
  const rb = timed(b) ? 1 : 0;

  if (ra !== rb) return ra - rb;

  const ta = (timed(a) && a.time) || "00:00";
  const tb = (timed(b) && b.time) || "00:00";

  if (ta < tb) return -1;
  if (ta > tb) return 1;

  return (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
}

type DayEvent = {
  date: string;
  endDate?: string | null;
  allDay?: boolean;
  time?: string | null;
  endTime?: string | null;
  title?: string;
  repeat?: string;
  until?: string | null;
  exceptDates?: string[];
};

/** One calendar day touched by one occurrence of an event. */
export type EventDay<T> = {
  /** The day this entry is about. */
  iso: string;
  ev: T;
  /** Start of the occurrence covering `iso` — the occurrence's identity. */
  startIso: string;
  /** 0 on the start day, 1 on the second day, and so on. */
  dayIndex: number;
  /** Inclusive covered-day count of this occurrence. */
  span: number;
};

/** Build the covered-day entry for `ev` on `iso`, or null when it isn't running. */
function eventDayFor<T extends DayEvent>(ev: T, iso: string): EventDay<T> | null {
  const startIso = occurrenceStartFor(ev, iso);
  if (startIso === null) return null;

  const span = spanDays(ev);

  return {
    iso,
    ev,
    startIso,
    dayIndex: span === 1 ? 0 : daysBetweenIso(startIso, iso),
    span,
  };
}

/**
 * Day → covered-occurrence map for one month. This is the display view: a
 * multi-day event appears on every day it runs through.
 */
export function eventDaysByMonth<T extends DayEvent>(
  events: T[],
  monthKey: string,
): Map<string, Array<EventDay<T>>> {
  const [y, m] = monthKey.split("-").map(Number);
  const days = new Date(y!, m!, 0).getDate();
  const map = new Map<string, Array<EventDay<T>>>();

  for (let d = 1; d <= days; d++) {
    map.set(`${monthKey}-${pad(d)}`, []);
  }

  for (const ev of events) {
    for (let d = 1; d <= days; d++) {
      const iso = `${monthKey}-${pad(d)}`;
      const day = eventDayFor(ev, iso);
      if (day) map.get(iso)!.push(day);
    }
  }

  for (const [, list] of map) {
    list.sort((a, b) =>
      compareEventsByEarliest({ ...a.ev, dayIndex: a.dayIndex }, { ...b.ev, dayIndex: b.dayIndex }),
    );
  }

  return map;
}

/** Covered-occurrence entries running on `iso`, sorted earliest-first. */
export function eventDaysForDay<T extends DayEvent>(events: T[], iso: string): Array<EventDay<T>> {
  return events
    .map((ev) => eventDayFor(ev, iso))
    .filter((d): d is EventDay<T> => d !== null)
    .sort((a, b) =>
      compareEventsByEarliest({ ...a.ev, dayIndex: a.dayIndex }, { ...b.ev, dayIndex: b.dayIndex }),
    );
}

/** Events running on `iso`, sorted earliest-first within the day. */
export function eventsForDay<T extends DayEvent>(events: T[], iso: string): T[] {
  return eventDaysForDay(events, iso).map((d) => d.ev);
}

/**
 * Occurrence *starts* within a month, sorted by date then earliest time.
 *
 * Deliberately one entry per occurrence rather than per covered day: this feeds
 * the envelope-hold math, where a 4-day event reserves its budget once, not once
 * a day. Use `eventDaysByMonth` for anything that renders days.
 */
export function scheduleForMonth<T extends DayEvent>(events: T[], monthKey: string) {
  const out: Array<{ iso: string; ev: T }> = [];

  for (const [iso, list] of eventDaysByMonth(events, monthKey)) {
    for (const day of list) {
      if (day.dayIndex === 0) out.push({ iso, ev: day.ev });
    }
  }

  return out;
}

/** Local YYYY-MM-DD for a Date. */
export function isoFromDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days from `from` to `to`, via UTC so DST never shifts the result. */
function daysBetweenIso(from: string, to: string): number {
  return spanDaysBetween(from, to) - 1;
}

/**
 * Has this occurrence already gone by? Dates before today have; dates after
 * have not. Today stays upcoming for all-day events and for timed events with
 * no end time. A timed event with an end time is passed once that clock is
 * behind `now` on its last covered day.
 */
function occurrencePassed(
  iso: string,
  ev: { allDay?: boolean; time?: string | null; endTime?: string | null },
  todayIso: string,
  nowHm: string,
  dayIndex = 0,
  span = 1,
): boolean {
  if (iso !== todayIso) return iso < todayIso;
  if (ev.allDay || !ev.endTime) return false;

  const lastDay = span <= 1 || dayIndex >= span - 1;
  if (!lastDay) return false;

  return ev.endTime < nowHm;
}

/**
 * Collapse each recurring series to its next occurrence, and each multi-day run
 * to a single row.
 *
 * A daily event would otherwise fill the agenda with one row per remaining day
 * of the month, and a week-long event with one row per day it covers; the agenda
 * only needs the one the user is heading toward. The kept entry is today's while
 * the occurrence is still running (no end time: the rest of today; with an end
 * time: until that clock), otherwise the next one in the list — so a run that
 * started before today stays visible, anchored to today rather than dropping out
 * with its past start day. Single-day one-time events drop out once they have
 * ended, and otherwise stay through today.
 *
 * `occurrences` must be ordered earliest-first (as `eventDaysByMonth` returns).
 */
export function collapseRecurringToNext<T extends DayEvent & { id: string }>(
  occurrences: Array<{ iso: string; ev: T; startIso?: string; dayIndex?: number; span?: number }>,
  now: Date = new Date(),
): Array<{ iso: string; ev: T; startIso?: string; dayIndex?: number; span?: number }> {
  const todayIso = isoFromDate(now);
  const nowHm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const kept = new Set<string>();
  const out: typeof occurrences = [];

  for (const o of occurrences) {
    const recurring = Boolean(o.ev.repeat) && o.ev.repeat !== "once";
    const spans = (o.span ?? 1) > 1;

    const passed = occurrencePassed(o.iso, o.ev, todayIso, nowHm, o.dayIndex ?? 0, o.span ?? 1);
    if (passed) continue;

    if (!recurring && !spans) {
      out.push(o);
      continue;
    }

    /* A recurring event collapses across occurrences too, not just within one. */
    const key = recurring ? o.ev.id : `${o.ev.id}|${o.startIso ?? o.iso}`;
    if (kept.has(key)) continue;

    kept.add(key);
    out.push(o);
  }

  return out;
}

/** Format HH:MM as a 12-hour clock string. */
export function fmtTime(t: string | null | undefined) {
  if (!t) return "";

  const [h, m] = t.split(":").map(Number);
  const ap = h! < 12 ? "AM" : "PM";
  const hh = ((h! + 11) % 12) + 1;

  return `${hh}:${pad(m!)} ${ap}`;
}

/**
 * Human-readable event time label for one covered day.
 *
 * An unset `endTime` is never filled in with a guess — the event just shows its
 * start time, and any later day it runs through reads as all-day:
 *
 *   all-day span         → "All day" every day
 *   timed, no end time   → "3:00 PM", then "All day"
 *   timed, end time      → "from 3:00 PM", "All day", "until 11:00 AM"
 *   timed, same day      → "3:00 – 4:30 PM"
 */
export function eventTimeLabel(ev: DayEvent, day?: { dayIndex: number; span: number }) {
  const dayIndex = day?.dayIndex ?? 0;
  const span = day?.span ?? spanDays(ev);
  const multiDay = span > 1;

  if (ev.allDay) return "All day";
  if (dayIndex > 0) {
    const last = dayIndex === span - 1;

    return last && ev.endTime ? `until ${fmtTime(ev.endTime)}` : "All day";
  }
  if (multiDay) return ev.endTime ? `from ${fmtTime(ev.time)}` : fmtTime(ev.time);

  return ev.endTime ? `${fmtTime(ev.time)} – ${fmtTime(ev.endTime)}` : fmtTime(ev.time);
}

/** "Day 2 of 4" for a day inside a multi-day run, or "" for single-day events. */
export function eventSpanLabel(day: { dayIndex: number; span: number }): string {
  if (day.span <= 1) return "";

  return `Day ${day.dayIndex + 1} of ${day.span}`;
}

/** Human-readable repeat label for an event. */
export function repeatLabel(ev: { repeat: string }) {
  /* REPEATS always has a "once" entry, so this fallback never misses. */
  return (REPEAT_BY_ID[ev.repeat] || REPEAT_BY_ID.once)!.label;
}

/** Human-readable lead-time label ("at" reads differently for all-day events). */
export function leadLabel(id: string, allDay = false) {
  if (allDay && id === "at") return ALL_DAY_AT_LEAD.label;

  /* LEAD_TIMES always has an "at" entry, so this fallback never misses. */
  return (LEAD_BY_ID[id] || LEAD_BY_ID.at)!.label;
}

/** Format a comment timestamp for display. */
export function fmtCommentTime(iso: string) {
  const d = new Date(iso);

  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Formatting helpers ──────────────────────────────────────────────

/** Round a money amount to 2 decimal places; non-finite input becomes 0. */
export function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;

  return Math.round(n * 100) / 100;
}

/** Format a number as currency with optional cents. */
export function fmtMoney(n: number, opts: { cents?: boolean; currency?: string } = {}) {
  const cur = getCurrency(opts.currency);
  const v = Math.abs(n);
  const s = v.toLocaleString("en-MY", {
    minimumFractionDigits: opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.cents === false ? 0 : 2,
  });

  return `${n < 0 ? "−" : ""}${cur.symbol}${s}`;
}

/** Whether a budget limit is a positive finite number. */
export function isBudgetSet(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** Format a budget limit, or "Unset" when none is set. */
export function fmtBudgetLimit(n: unknown, opts: { currency?: string } = {}) {
  return isBudgetSet(n) ? fmtMoney(n, opts) : "Unset";
}

/** Compact currency format (e.g. RM1.2k). */
export function fmtMoneyShort(n: number, currency?: string) {
  const cur = getCurrency(currency);

  if (Math.abs(n) >= 1000) return `${cur.symbol}${(n / 1000).toFixed(1)}k`;

  return `${cur.symbol}${Math.round(n)}`;
}

/** Format a YYYY-MM key as a month label. */
export function monthLabel(key: string, long?: boolean) {
  const [y, mm] = key.split("-").map(Number);
  const d = new Date(y!, mm! - 1, 1);

  return d.toLocaleString("en-US", {
    month: long ? "long" : "short",
    year: long ? "numeric" : undefined,
  });
}

/** Format an ISO date as day + short month. */
export function dayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");

  return d.toLocaleString("en-US", { day: "numeric", month: "short" });
}

/** Format an ISO date as a short weekday. */
export function weekdayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");

  return d.toLocaleString("en-US", { weekday: "short" });
}
