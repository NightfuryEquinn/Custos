import { DEFAULT_TIMEZONE, zonedLocalToUtcMs } from "@/lib/timezone";
import { recurringDueDate } from "@/lib/recurring";
import { spanDaysBetween, type LeadId } from "@/schemas/common";

export type ScheduleEvent = {
  date: string;
  allDay: boolean;
  time: string | null;
  repeat: string;
  lead: LeadId;
  exceptDates?: string[];
  until?: string | null;
  /** Inclusive last covered day of one occurrence; absent = single-day. */
  endDate?: string | null;
  /** End clock time on the last covered day; absent = no end time set. */
  endTime?: string | null;
};

/** Minimal shape needed to evaluate recurrence on a calendar day. */
type OccurrenceEvent = {
  date: string;
  /** Absent behaves as "once". */
  repeat?: string;
  exceptDates?: string[];
  until?: string | null;
};

/** An occurrence event that may cover more than one calendar day. */
type SpanningEvent = OccurrenceEvent & { endDate?: string | null };

const LEAD_MS: Record<LeadId, number> = {
  at: 0,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "2d": 2 * 24 * 60 * 60 * 1000,
};

const LEAD_LABELS: Record<LeadId, string> = {
  at: "at the time of the event",
  "15m": "15 minutes before",
  "30m": "30 minutes before",
  "1h": "1 hour before",
  "6h": "6 hours before",
  "12h": "12 hours before",
  "1d": "1 day before",
  "2d": "2 days before",
};

/** All-day events have no clock time, so reminders anchor to this local hour. */
export const ALL_DAY_REMINDER_TIME = "09:00";

/** All-day events fire "at" on the event day itself rather than at a clock time. */
const ALL_DAY_AT_LABEL = "on the day of the event (9:00 AM)";

/**
 * External cron poll cadence (cron-job.org should run at this interval).
 * Each run scans the database for reminders whose target time falls in the due window.
 */
export const REMINDER_POLL_INTERVAL_MS = 15 * 60 * 1000;

/** Fire up to this many ms before the configured remind-at time. */
const REMINDER_EARLY_BUFFER_MS = 15 * 60 * 1000;

/**
 * True when `now` is inside the send window for a reminder:
 * remindAt − earlyBuffer ≤ now ≤ remindAt + pollInterval.
 */
export function isReminderDueNow(
  remindAtMs: number,
  nowMs: number = Date.now(),
  pollIntervalMs = REMINDER_POLL_INTERVAL_MS,
  earlyBufferMs = REMINDER_EARLY_BUFFER_MS,
): boolean {
  return nowMs >= remindAtMs - earlyBufferMs && nowMs <= remindAtMs + pollIntervalMs;
}

/**
 * True when an occurrence is far enough in the past that reminding is pointless.
 * Mirrors the late tolerance of `isReminderDueNow`, so a zero-lead reminder
 * (e.g. an all-day event at 09:00) still goes out when the poll lands just
 * after the event time instead of being dropped.
 */
export function isOccurrencePast(
  eventAtMs: number,
  nowMs: number = Date.now(),
  pollIntervalMs = REMINDER_POLL_INTERVAL_MS,
): boolean {
  return nowMs > eventAtMs + pollIntervalMs;
}

/** Milliseconds before event time for a given reminder lead id. */
function leadOffsetMs(lead: LeadId): number {
  return LEAD_MS[lead] ?? 0;
}

/** Human-readable reminder lead phrase (e.g. "1 day before"). */
export function leadDescription(lead: LeadId, allDay = false): string {
  if (allDay && lead === "at") return ALL_DAY_AT_LABEL;

  return LEAD_LABELS[lead] ?? LEAD_LABELS.at;
}

/**
 * Whether a (possibly recurring) event occurs on the given ISO calendar day.
 * Respects `until` (inclusive) and `exceptDates`.
 */
export function occursOn(ev: OccurrenceEvent, iso: string): boolean {
  if (iso < ev.date) return false;
  if (ev.until && iso > ev.until) return false;
  if (ev.exceptDates?.includes(iso)) return false;

  const a = new Date(`${ev.date}T00:00:00`);
  const b = new Date(`${iso}T00:00:00`);
  switch (ev.repeat) {
    case "once":
      return iso === ev.date;
    case "daily":
      return true;
    case "weekly":
      return a.getDay() === b.getDay();
    case "biweekly":
      /* Every other week from the start date, so a 14-day stride from `ev.date`. */
      return (isoDayNumber(iso) - isoDayNumber(ev.date)) % 14 === 0;
    case "monthly": {
      const monthKey = `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, "0")}`;
      return iso === recurringDueDate(ev.date, monthKey);
    }
    case "yearly":
      return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
    default:
      return iso === ev.date;
  }
}

/**
 * Inclusive covered-day count for one occurrence (1 for a single-day event).
 * `endDate` before `date` is treated as unset rather than a negative span.
 */
export function spanDays(ev: { date: string; endDate?: string | null }): number {
  return spanDaysBetween(ev.date, ev.endDate);
}

/**
 * The start of the occurrence whose span covers `iso`, or null when none does.
 *
 * Walks back at most `span - 1` days and delegates to `occursOn`, so
 * `exceptDates` and `until` keep applying to occurrence *starts* — removing an
 * occurrence removes the whole run, not just the day that was clicked.
 */
export function occurrenceStartFor(ev: SpanningEvent, iso: string): string | null {
  const span = spanDays(ev);

  for (let back = 0; back < span; back++) {
    const start = back === 0 ? iso : shiftIso(iso, -back);
    if (start < ev.date) break;
    if (occursOn(ev, start)) return start;
  }

  return null;
}

/** Inclusive last covered day of the occurrence starting on `startIso`. */
function occurrenceEndIso(ev: { date: string; endDate?: string | null }, startIso: string): string {
  const span = spanDays(ev);

  return span === 1 ? startIso : shiftIso(startIso, span - 1);
}

/**
 * Last covered instant of the occurrence starting on `startIso`.
 * Without an `endTime` the final day counts as fully covered, so the occurrence
 * runs to the same anchor hour an all-day event would use.
 */
export function occurrenceEndMs(
  ev: {
    date: string;
    endDate?: string | null;
    endTime?: string | null;
    time: string | null;
    allDay: boolean;
  },
  startIso: string,
  timeZone = DEFAULT_TIMEZONE,
): number {
  const endIso = occurrenceEndIso(ev, startIso);
  const multiDay = endIso !== startIso;

  if (!ev.allDay && ev.endTime) {
    return zonedLocalToUtcMs(endIso, ev.endTime, timeZone);
  }
  /* No end time: a later day is covered whole, the start day keeps its own time. */
  if (multiDay) return eventTimeMs(endIso, null, true, timeZone);

  return eventTimeMs(startIso, ev.time, ev.allDay, timeZone);
}

/**
 * ISO dates to scan for due reminders: today −2 through today + lead horizon,
 * padded for timezone offsets. `span` extends the lookback so an occurrence that
 * started days ago but is still running is still found.
 */
function candidateOccurrenceDates(lead: LeadId, now = new Date(), span = 1): string[] {
  const horizon = Math.ceil(leadOffsetMs(lead) / (24 * 60 * 60 * 1000)) + 3;
  const lookback = 2 + Math.max(0, span - 1);
  const start = new Date(now);
  start.setDate(start.getDate() - lookback);
  const out: string[] = [];
  for (let i = 0; i < lookback + horizon + 3; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(formatIsoDate(d));
  }
  return out;
}

function eventTimeMs(
  iso: string,
  time: string | null,
  allDay: boolean,
  timeZone = DEFAULT_TIMEZONE,
): number {
  const hhmm = allDay ? ALL_DAY_REMINDER_TIME : (time ?? ALL_DAY_REMINDER_TIME);
  return zonedLocalToUtcMs(iso, hhmm, timeZone);
}

export function remindAtMs(
  ev: ScheduleEvent,
  occurrenceIso: string,
  timeZone = DEFAULT_TIMEZONE,
): number {
  return eventTimeMs(occurrenceIso, ev.time, ev.allDay, timeZone) - leadOffsetMs(ev.lead);
}

/**
 * Human-readable span for one occurrence, e.g.
 * "Monday, 10 August 2026 at 3:00 PM MYT — Thursday, 13 August 2026 at 11:00 AM MYT".
 * Falls back to the single-day form when the occurrence covers one day.
 */
export function formatOccurrenceWhen(
  ev: {
    date: string;
    time: string | null;
    allDay: boolean;
    endDate?: string | null;
    endTime?: string | null;
  },
  startIso: string,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const endIso = occurrenceEndIso(ev, startIso);
  const start = formatEventWhen(startIso, ev.time, ev.allDay, timeZone);

  if (endIso === startIso) return start;

  /* Without an end time the closing day is covered whole, so read it as all-day. */
  const end =
    ev.allDay || !ev.endTime
      ? formatEventWhen(endIso, null, true, timeZone)
      : formatEventWhen(endIso, ev.endTime, false, timeZone);

  return `${start} — ${end}`;
}

function formatEventWhen(
  iso: string,
  time: string | null,
  allDay: boolean,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const noonMs = zonedLocalToUtcMs(iso, "12:00", timeZone);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(noonMs));
  if (allDay) return `${day} (All day)`;
  if (!time) return day;
  const [hRaw, m] = time.split(":").map(Number);
  const h = hRaw ?? 0;
  const ap = h < 12 ? "AM" : "PM";
  const hh = ((h + 11) % 12) + 1;
  const tzLabel = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(new Date(noonMs))
    .find((p) => p.type === "timeZoneName")?.value;
  const suffix = tzLabel ? ` ${tzLabel}` : "";
  return `${day} at ${hh}:${String(m).padStart(2, "0")} ${ap}${suffix}`;
}

/** Dedupe key stored in `reminderLogs.lead` for daily "still running" sends. */
const SPAN_REMINDER_LEAD = "span";

export type ReminderTarget = {
  /** Occurrence start — the occurrence's identity for dedupe and content. */
  occurrenceIso: string;
  /** Calendar day this particular reminder is about. */
  dayIso: string;
  kind: "lead" | "ongoing";
  remindAtMs: number;
  /** Value written to `reminderLogs.lead`, keeping the two kinds distinct. */
  logLead: string;
};

/**
 * Every reminder this event wants delivered around `now`.
 *
 *   lead    — one per occurrence, at the configured lead before it starts, PLUS an
 *             always-on send right at the event's own start (`logLead: "at"`) — the
 *             clock time for a timed event, 09:00 local for an all-day one. Deduped
 *             into a single target when the chosen lead already is "at".
 *   ongoing — 09:00 local on each day a multi-day occurrence is still running.
 *
 * Single-day events produce one or two `lead` targets (never more).
 * Callers still gate on `isReminderDueNow` and the reminder log.
 */
export function reminderTargets(
  ev: ScheduleEvent,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): ReminderTarget[] {
  const span = spanDays(ev);
  const out: ReminderTarget[] = [];

  for (const startIso of candidateOccurrenceDates(ev.lead, now, span)) {
    if (!occursOn(ev, startIso)) continue;

    const leadAt = remindAtMs(ev, startIso, timeZone);
    out.push({
      occurrenceIso: startIso,
      dayIso: startIso,
      kind: "lead",
      remindAtMs: leadAt,
      logLead: ev.lead,
    });

    /* Always also remind right at the event's own start — the chosen lead is
       an extra early warning, not a replacement for the day-of/at-time nudge. */
    const atMs = eventTimeMs(startIso, ev.time, ev.allDay, timeZone);
    if (atMs !== leadAt) {
      out.push({
        occurrenceIso: startIso,
        dayIso: startIso,
        kind: "lead",
        remindAtMs: atMs,
        logLead: "at",
      });
    }

    if (span === 1) continue;

    const endIso = occurrenceEndIso(ev, startIso);
    for (let i = 0; i < span; i++) {
      const dayIso = i === 0 ? startIso : shiftIso(startIso, i);
      /* The event is already over before the 09:00 send on its closing day. */
      if (dayIso === endIso && !ev.allDay && ev.endTime && ev.endTime < ALL_DAY_REMINDER_TIME) {
        continue;
      }

      const remindAt = zonedLocalToUtcMs(dayIso, ALL_DAY_REMINDER_TIME, timeZone);
      /* Don't double-send when the lead or at-event reminder already lands at 09:00 today. */
      if (dayIso === startIso && (remindAt === leadAt || remindAt === atMs)) continue;

      out.push({
        occurrenceIso: startIso,
        dayIso,
        kind: "ongoing",
        remindAtMs: remindAt,
        logLead: SPAN_REMINDER_LEAD,
      });
    }
  }

  return out;
}

/** Whole days since the epoch for an ISO date, unaffected by local DST shifts. */
function isoDayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);

  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

/** ISO date `delta` days from `iso`, via UTC so DST never shifts the result. */
export function shiftIso(iso: string, delta: number): string {
  const d = new Date(isoDayNumber(iso) * 86_400_000 + delta * 86_400_000);

  return d.toISOString().slice(0, 10);
}

function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
