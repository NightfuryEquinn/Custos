import {
  colIndex,
  isValidIsoDate,
  OBJECT_ID,
  parseCsv,
  stripBom,
  type ImportRowError,
  type ImportRowNotice,
} from "@/frontend/auth/lib/csv";
import { EVENT_CATS } from "@/frontend/lib/data";
import type { EventComment, LedgerEvent } from "@/frontend/lib/types";
import {
  EVENT_CATEGORY_IDS,
  LEAD_IDS,
  REPEAT_IDS,
  isLeadAllowedForEvent,
  isRepeatAllowedForSpan,
  spanDaysBetween,
  type LeadId,
  type RepeatId,
} from "@/lib/event-rules";

export type EventImportRow = Omit<LedgerEvent, "id">;

type ParseEventsCsvResult = {
  rows: EventImportRow[];
  errors: ImportRowError[];
  notices: ImportRowNotice[];
  stats: { skipped: number };
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EVENT_CAT_IDS = new Set<string>(EVENT_CATEGORY_IDS);
const REPEAT_SET = new Set<string>(REPEAT_IDS);
const LEAD_SET = new Set<string>(LEAD_IDS);

/** Map removed lead ids from older exports to the nearest current option. */
const LEGACY_LEAD_MAP: Record<string, LeadId> = {
  "10m": "15m",
  "1w": "2d",
};

function resolveLead(raw: string): string {
  if (LEAD_SET.has(raw)) return raw;
  return LEGACY_LEAD_MAP[raw] ?? raw;
}

function parseYesNo(value: string, defaultValue = false): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return defaultValue;
  return v === "yes" || v === "true" || v === "1";
}

function parseComments(raw: string, rowNum: number, errors: ImportRowError[]): EventComment[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("not array");
    return parsed as EventComment[];
  } catch {
    errors.push({ row: rowNum, message: "CommentsJson must be a valid JSON array." });
    return [];
  }
}

function resolveEventCategory(
  catId: string,
  catName: string,
  customLabel: string,
  customGlyph: string,
): { catId: string; customLabel?: string; customGlyph?: string } | { error: string } {
  const id = catId.trim();
  const name = catName.trim().toLowerCase();
  const label = customLabel.trim();
  const glyph = customGlyph.trim();

  if (id && EVENT_CAT_IDS.has(id as (typeof EVENT_CATEGORY_IDS)[number])) {
    if (id === "custom") {
      if (!label) return { error: "CustomLabel is required for custom event types." };
      if (!glyph) return { error: "CustomGlyph is required for custom event types." };
      return { catId: "custom", customLabel: label, customGlyph: glyph };
    }
    return { catId: id };
  }

  if (name) {
    const byName = EVENT_CATS.find((c) => c.name.toLowerCase() === name);
    if (byName) {
      if (byName.id === "custom") {
        if (!label) return { error: "CustomLabel is required for custom event types." };
        if (!glyph) return { error: "CustomGlyph is required for custom event types." };
        return { catId: "custom", customLabel: label, customGlyph: glyph };
      }
      return { catId: byName.id };
    }
  }

  if (label || glyph) {
    if (!label) return { error: "CustomLabel is required for custom event types." };
    if (!glyph) return { error: "CustomGlyph is required for custom event types." };
    return { catId: "custom", customLabel: label, customGlyph: glyph };
  }

  return { catId: "personal" };
}

export function parseEventsCsv(
  text: string,
  existingIds: Iterable<string> = [],
): ParseEventsCsvResult {
  const rows: EventImportRow[] = [];
  const errors: ImportRowError[] = [];
  const notices: ImportRowNotice[] = [];
  const ledgerIds = new Set([...existingIds].map((id) => id.toLowerCase()));
  const seenInFile = new Set<string>();
  let skipped = 0;

  const parsed = parseCsv(stripBom(text));
  if (!parsed.length) {
    return {
      rows,
      errors: [{ row: 0, message: "The file is empty." }],
      notices,
      stats: { skipped: 0 },
    };
  }

  const headerMap = Object.fromEntries(parsed[0]!.map((h, i) => [h.trim().toLowerCase(), i]));
  const idIdx = colIndex(headerMap, "id");
  const titleIdx = colIndex(headerMap, "title");
  const catIdIdx = colIndex(headerMap, "categoryid", "category id");
  const catIdx = colIndex(headerMap, "category");
  const customLabelIdx = colIndex(headerMap, "customlabel", "custom label");
  const customGlyphIdx = colIndex(headerMap, "customglyph", "custom glyph");
  const dateIdx = colIndex(headerMap, "date");
  const endDateIdx = colIndex(headerMap, "enddate", "end date");
  const allDayIdx = colIndex(headerMap, "allday", "all day");
  const timeIdx = colIndex(headerMap, "time");
  const endTimeIdx = colIndex(headerMap, "endtime", "end time");
  const repeatIdx = colIndex(headerMap, "repeat");
  const notifyIdx = colIndex(headerMap, "notify");
  const leadIdx = colIndex(headerMap, "lead");
  const emailIdx = colIndex(headerMap, "email");
  const commentsIdx = colIndex(headerMap, "commentsjson", "comments json", "comments");

  if (titleIdx === undefined || dateIdx === undefined) {
    return {
      rows,
      errors: [{ row: 0, message: "Missing required columns: Title and Date." }],
      notices,
      stats: { skipped: 0 },
    };
  }

  parsed.slice(1).forEach((cells, i) => {
    const rowNum = i + 2;
    const get = (idx: number | undefined) => (idx === undefined ? "" : (cells[idx] ?? "").trim());

    const csvId = get(idIdx);
    if (csvId) {
      if (!OBJECT_ID.test(csvId)) {
        errors.push({ row: rowNum, message: `Invalid ID "${csvId}".` });
        return;
      }
      const normalizedId = csvId.toLowerCase();
      if (ledgerIds.has(normalizedId)) {
        errors.push({ row: rowNum, message: "Event already in your schedule (duplicate ID)." });
        skipped++;
        return;
      }
      if (seenInFile.has(normalizedId)) {
        errors.push({ row: rowNum, message: "Duplicate ID in this file." });
        skipped++;
        return;
      }
      seenInFile.add(normalizedId);
    }

    const title = get(titleIdx);
    if (!title) {
      errors.push({ row: rowNum, message: "Title is required." });
      return;
    }

    const date = get(dateIdx);
    if (!isValidIsoDate(date)) {
      errors.push({
        row: rowNum,
        message: `Invalid date "${date || "(empty)"}" — use YYYY-MM-DD.`,
      });
      return;
    }

    const catResolved = resolveEventCategory(
      get(catIdIdx),
      get(catIdx),
      get(customLabelIdx),
      get(customGlyphIdx),
    );
    if ("error" in catResolved) {
      errors.push({ row: rowNum, message: catResolved.error });
      return;
    }

    const allDay = allDayIdx === undefined ? true : parseYesNo(get(allDayIdx), true);
    const timeRaw = get(timeIdx);
    let time: string | null = null;
    if (!allDay) {
      if (!timeRaw || !TIME_RE.test(timeRaw)) {
        errors.push({
          row: rowNum,
          message: `Invalid time "${timeRaw || "(empty)"}" — use HH:MM.`,
        });
        return;
      }
      time = timeRaw;
    }

    /* Both end columns are optional — an absent end time stays absent. */
    const endDateRaw = get(endDateIdx);
    let endDate: string | null = null;
    if (endDateRaw) {
      if (!isValidIsoDate(endDateRaw)) {
        errors.push({ row: rowNum, message: `Invalid end date "${endDateRaw}" — use YYYY-MM-DD.` });
        return;
      }
      if (endDateRaw < date) {
        errors.push({ row: rowNum, message: "End date cannot be before the start date." });
        return;
      }
      if (endDateRaw > date) endDate = endDateRaw;
    }

    const endTimeRaw = get(endTimeIdx);
    let endTime: string | null = null;
    if (endTimeRaw) {
      if (allDay) {
        errors.push({ row: rowNum, message: "All-day events cannot have an end time." });
        return;
      }
      if (!TIME_RE.test(endTimeRaw)) {
        errors.push({ row: rowNum, message: `Invalid end time "${endTimeRaw}" — use HH:MM.` });
        return;
      }
      if (!endDate && time && endTimeRaw <= time) {
        errors.push({ row: rowNum, message: "End time must be after the start time." });
        return;
      }
      endTime = endTimeRaw;
    }

    const repeatRaw = get(repeatIdx) || "once";
    if (!REPEAT_SET.has(repeatRaw)) {
      errors.push({ row: rowNum, message: `Invalid repeat "${repeatRaw}".` });
      return;
    }
    const span = spanDaysBetween(date, endDate);
    if (!isRepeatAllowedForSpan(repeatRaw as RepeatId, span)) {
      errors.push({
        row: rowNum,
        message: `A ${span}-day event cannot repeat "${repeatRaw}" — occurrences would overlap.`,
      });
      return;
    }

    const notify = parseYesNo(get(notifyIdx), false);
    const leadResolved = resolveLead(get(leadIdx) || "1d");
    if (!LEAD_SET.has(leadResolved)) {
      errors.push({ row: rowNum, message: `Invalid lead "${get(leadIdx)}".` });
      return;
    }
    const lead = leadResolved as LeadId;
    if (!isLeadAllowedForEvent(lead, allDay)) {
      errors.push({
        row: rowNum,
        message: allDay
          ? `All-day events only support "at", "1d" or "2d" lead (got "${lead}").`
          : `Invalid lead "${lead}" for timed events.`,
      });
      return;
    }

    const email = get(emailIdx);
    const comments =
      commentsIdx === undefined ? [] : parseComments(get(commentsIdx), rowNum, errors);
    if (
      commentsIdx !== undefined &&
      get(commentsIdx) &&
      comments.length === 0 &&
      errors.some((e) => e.row === rowNum)
    ) {
      return;
    }

    rows.push({
      title,
      catId: catResolved.catId,
      customLabel: catResolved.customLabel,
      customGlyph: catResolved.customGlyph,
      date,
      endDate,
      allDay,
      time,
      endTime,
      repeat: repeatRaw,
      notify,
      lead,
      email,
      comments,
    });
  });

  return { rows, errors, notices, stats: { skipped } };
}
