import { z } from "zod";
import {
  accountIdSchema,
  eventCategoryIdSchema,
  isoDateSchema,
  isLeadAllowedForEvent,
  isRepeatAllowedForSpan,
  leadIdSchema,
  objectIdSchema,
  repeatIdSchema,
  spanDaysBetween,
  type LeadId,
  type RepeatId,
} from "./common";
import { encryptedPayloadSchema, e2eeVersionSchema } from "./encryption";

const eventCommentSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(2000),
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
});

const customLabelSchema = z.string().min(1).max(40);
const customGlyphSchema = z.string().min(1).max(8);

/**
 * Server-readable copy of the event content that reminder emails render.
 * Event secrets stay E2EE, so the client decrypts and sends this alongside the
 * ciphertext when (and only when) email reminders are switched on — the email
 * body itself is plaintext, so delivery is the consent point.
 */
export const reminderDetailsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  hold: z
    .object({
      amount: z.number().nonnegative(),
      currency: z.string().trim().min(3).max(3).optional(),
      categoryName: z.string().trim().min(1).max(64).optional(),
    })
    .optional(),
  comments: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
});

/** Refine lead against allDay for plaintext schedule fields. */
function refineLeadForAllDay(data: { allDay?: boolean; lead?: LeadId }, ctx: z.RefinementCtx) {
  if (data.lead === undefined) return;
  const allDay = data.allDay ?? true;
  if (!isLeadAllowedForEvent(data.lead, allDay)) {
    ctx.addIssue({
      code: "custom",
      message: allDay
        ? "All-day events only support day-of or day-based reminders"
        : "Invalid reminder lead for timed events",
      path: ["lead"],
    });
  }
}

type SpanFields = {
  date?: string;
  endDate?: string | null;
  time?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  repeat?: RepeatId;
};

/**
 * Refine the multi-day span: an end that is not before the start, no end time
 * on an all-day event, and a repeat whose next occurrence starts after this one
 * finishes. A patch that touches none of the span fields is left alone — the
 * route re-validates the merged document.
 */
function refineSpan(data: SpanFields, ctx: z.RefinementCtx) {
  const { date, endDate } = data;
  if (!date || !endDate) return;

  if (endDate < date) {
    ctx.addIssue({
      code: "custom",
      message: "End date cannot be before the start date",
      path: ["endDate"],
    });

    return;
  }

  const allDay = data.allDay ?? true;
  if (allDay && data.endTime) {
    ctx.addIssue({
      code: "custom",
      message: "All-day events cannot have an end time",
      path: ["endTime"],
    });
  }

  if (endDate === date && !allDay && data.endTime && data.time && data.endTime <= data.time) {
    ctx.addIssue({
      code: "custom",
      message: "End time must be after the start time",
      path: ["endTime"],
    });
  }

  const repeat = data.repeat ?? "once";
  const span = spanDaysBetween(date, endDate);
  if (!isRepeatAllowedForSpan(repeat, span)) {
    ctx.addIssue({
      code: "custom",
      message: `A ${span}-day event cannot repeat ${repeat} — occurrences would overlap`,
      path: ["repeat"],
    });
  }
}

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const eventScheduleShape = {
  catId: eventCategoryIdSchema,
  date: isoDateSchema,
  /** Inclusive last covered day; null/undefined means a single-day event. */
  endDate: isoDateSchema.nullable().optional(),
  allDay: z.boolean().default(true),
  time: timeOfDaySchema.nullable().default(null),
  /** End clock time on `endDate`; null/undefined means none was set. */
  endTime: timeOfDaySchema.nullable().optional(),
  repeat: repeatIdSchema.default("once"),
  /** Occurrence dates removed with "This Only". */
  exceptDates: z.array(isoDateSchema).optional(),
  /** Inclusive last occurrence; null/undefined means unbounded. */
  until: isoDateSchema.nullable().optional(),
  notify: z.boolean().default(false),
  lead: leadIdSchema.default("1d"),
  email: z.string().email().optional().or(z.literal("")),
  /** Plaintext event content for reminder emails (only while notify is on). */
  notifyDetails: reminderDetailsSchema.optional(),
  /** Optional expense logged from this event (e.g. bill paid). */
  expenseId: objectIdSchema.optional(),
};

const eventSchema = z.object({
  accountId: accountIdSchema,
  ...eventScheduleShape,
  enc: e2eeVersionSchema.optional(),
  payload: encryptedPayloadSchema.optional(),
  /** Legacy plaintext secrets (pre-E2EE). */
  title: z.string().min(1).max(200).optional(),
  customLabel: customLabelSchema.optional(),
  customGlyph: customGlyphSchema.optional(),
  comments: z.array(eventCommentSchema).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createEventSchema = z
  .object({
    /** Optional client-minted id (offline write queue) — see expense.ts's `id`. */
    id: objectIdSchema.optional(),
    catId: eventCategoryIdSchema,
    date: isoDateSchema,
    endDate: isoDateSchema.nullable().optional(),
    allDay: z.boolean().optional().default(true),
    time: timeOfDaySchema.nullable().optional().default(null),
    endTime: timeOfDaySchema.nullable().optional(),
    repeat: repeatIdSchema.optional().default("once"),
    notify: z.boolean().optional().default(false),
    lead: leadIdSchema.optional().default("1d"),
    email: z.string().email().optional().or(z.literal("")),
    notifyDetails: reminderDetailsSchema.optional(),
    expenseId: objectIdSchema.optional(),
    enc: e2eeVersionSchema,
    payload: encryptedPayloadSchema,
  })
  .superRefine(refineLeadForAllDay)
  .superRefine(refineSpan);

export const updateEventSchema = z
  .object({
    catId: eventCategoryIdSchema.optional(),
    date: isoDateSchema.optional(),
    endDate: isoDateSchema.nullable().optional(),
    allDay: z.boolean().optional(),
    time: timeOfDaySchema.nullable().optional(),
    endTime: timeOfDaySchema.nullable().optional(),
    repeat: repeatIdSchema.optional(),
    exceptDates: z.array(isoDateSchema).optional(),
    until: isoDateSchema.nullable().optional(),
    notify: z.boolean().optional(),
    lead: leadIdSchema.optional(),
    email: z.string().email().optional().or(z.literal("")),
    /** `null` clears the stored plaintext copy (e.g. reminders switched off). */
    notifyDetails: reminderDetailsSchema.nullable().optional(),
    expenseId: objectIdSchema.nullable().optional(),
    enc: e2eeVersionSchema,
    payload: encryptedPayloadSchema,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  })
  .superRefine(refineLeadForAllDay)
  .superRefine(refineSpan);

export const listEventsQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional().default(2000),
  before: isoDateSchema.optional(),
  beforeId: objectIdSchema.optional(),
});

export type ReminderDetails = z.infer<typeof reminderDetailsSchema>;
export type Event = z.infer<typeof eventSchema>;
