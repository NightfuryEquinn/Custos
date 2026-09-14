import { notFound } from "@/api/lib/errors";
import { randomObjectId } from "@/api/lib/ids";
import { insertOwned } from "@/api/lib/insert-idempotent";
import { keepReminderDetails, reminderDetailsUpdate } from "@/api/lib/reminder-details";
import {
  clearReminderLogsForEvent,
  sendEventConfirmation,
  sendImmediateReminderIfDue,
} from "@/api/lib/reminders";
import { serializeDoc, serializeDocs } from "@/api/lib/serialize";
import { dateIdCursorClause, pageCursorFromDocs } from "@/api/lib/pagination";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb } from "@/db";
import { deleteScopeQuerySchema, resolveEventDeleteAction } from "@/lib/delete-scope";
import { shiftIso } from "@/lib/schedule";
import {
  isLeadAllowedForEvent,
  isRepeatAllowedForSpan,
  monthDateBounds,
  objectIdSchema,
  spanDaysBetween,
  type LeadId,
  type RepeatId,
} from "@/schemas/common";
import { createEventSchema, listEventsQuerySchema, updateEventSchema } from "@/schemas/event";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ObjectId } from "mongodb";

/**
 * How far before the window to look for multi-day series that may spill into it.
 * Deliberately generous — the over-fetch is bounded to multi-day series that
 * ended within the past year, and the client filters exactly.
 */
const MAX_SPAN_LOOKBACK_DAYS = 366;

export const eventsRoutes = new Hono<{ Variables: SessionVariables }>();

eventsRoutes.use("*", sessionAuth);

eventsRoutes.get("/", zValidator("query", listEventsQuerySchema), async (c) => {
  const accountId = c.get("accountId");
  const { month, from, to, limit, before, beforeId } = c.req.valid("query");
  const { events } = getCollections(getDb());

  const filter: Record<string, unknown> = { accountId };

  /*
   * Recurring events may start before the window but still occur inside it, and
   * a multi-day event may start before the window and still run into it. Include
   * non-once rows that have not ended before the window start, plus once rows
   * that overlap the range at all.
   */
  if (month || from || to || before) {
    const bounds = month ? monthDateBounds(month) : null;
    const rangeStart = bounds?.$gte ?? from;
    const rangeEnd = bounds?.$lte ?? to;
    const onceDate: Record<string, string> = {};
    if (rangeStart) onceDate.$gte = rangeStart;
    if (rangeEnd) onceDate.$lte = rangeEnd;

    const clauses: Record<string, unknown>[] = [{ repeat: "once", date: onceDate }];

    /* A once-event starting before the window but ending inside it. */
    if (rangeStart) {
      const spillDate: Record<string, string> = { $lt: rangeStart };
      clauses.push({
        repeat: "once",
        date: spillDate,
        endDate: { $gte: rangeStart },
      });
    }

    if (rangeStart) {
      clauses.push(
        { repeat: { $ne: "once" }, until: { $gte: rangeStart } },
        { repeat: { $ne: "once" }, until: null },
        { repeat: { $ne: "once" }, until: { $exists: false } },
        /*
         * A series whose last occurrence *starts* just before the window can
         * still run into it. Widen the bound for multi-day series only; the
         * client filters exactly via `coversOn`.
         */
        {
          repeat: { $ne: "once" },
          endDate: { $exists: true, $ne: null },
          until: { $gte: shiftIso(rangeStart, -MAX_SPAN_LOOKBACK_DAYS) },
        },
      );
    } else {
      clauses.push({ repeat: { $ne: "once" } });
    }

    if (before) {
      filter.$and = [{ $or: clauses }, { $or: dateIdCursorClause(before, beforeId) }];
    } else {
      filter.$or = clauses;
    }
  }

  const docs = await events.find(filter).sort({ date: -1, _id: -1 }).limit(limit).toArray();
  const { hasMore, nextBefore, nextBeforeId } = pageCursorFromDocs(docs, limit);

  return c.json({
    events: serializeDocs(docs),
    hasMore,
    nextBefore,
    nextBeforeId,
  });
});

eventsRoutes.post("/", zValidator("json", createEventSchema), async (c) => {
  const accountId = c.get("accountId");
  const body = c.req.valid("json");
  const now = new Date();
  const { events } = getCollections(getDb());

  const { id, expenseId, notifyDetails, email: _ignoredEmail, ...rest } = body;
  const keepDetails = keepReminderDetails({
    details: notifyDetails,
    notify: rest.notify,
  });
  const { doc, created } = await insertOwned(events, {
    _id: id ? new ObjectId(id) : randomObjectId(),
    accountId,
    ...rest,
    ...(keepDetails ? { notifyDetails } : {}),
    ...(expenseId ? { expenseId: new ObjectId(expenseId) } : {}),
    createdAt: now,
    updatedAt: now,
  });

  /* Only on a genuine new insert — a replayed create (offline write queue
     retry) must not re-send the confirmation/immediate reminder email. */
  if (created) {
    void sendEventConfirmation(doc).catch((err) =>
      console.error("[reminders] confirmation email failed:", err),
    );
    /* If the remind-at time is in the current poll window, send now instead of waiting for cron. */
    void sendImmediateReminderIfDue(doc).catch((err) =>
      console.error("[reminders] immediate reminder failed:", err),
    );
  }

  return c.json({ event: serializeDoc(doc) }, created ? 201 : 200);
});

eventsRoutes.patch("/:id", zValidator("json", updateEventSchema), async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Event not found");

  const body = c.req.valid("json");
  const { events } = getCollections(getDb());

  const existing = await events.findOne({
    _id: new ObjectId(id.data),
    accountId,
  });
  if (!existing) notFound("Event not found");

  const mergedAllDay = body.allDay ?? existing.allDay;
  const mergedLead = (body.lead ?? existing.lead) as LeadId;
  if (!isLeadAllowedForEvent(mergedLead, mergedAllDay)) {
    throw new HTTPException(400, {
      message: mergedAllDay
        ? "All-day events only support day-of, 1 day or 2 days before reminders"
        : "Invalid reminder lead for timed events",
    });
  }

  /* A patch may change one half of the span, so re-check the merged result. */
  const mergedDate = body.date ?? existing.date;
  const mergedEndDate = body.endDate !== undefined ? body.endDate : existing.endDate;
  const mergedRepeat = (body.repeat ?? existing.repeat) as RepeatId;
  if (mergedEndDate && mergedEndDate < mergedDate) {
    throw new HTTPException(400, { message: "End date cannot be before the start date" });
  }
  const mergedSpan = spanDaysBetween(mergedDate, mergedEndDate);
  if (!isRepeatAllowedForSpan(mergedRepeat, mergedSpan)) {
    throw new HTTPException(400, {
      message: `A ${mergedSpan}-day event cannot repeat ${mergedRepeat} — occurrences would overlap`,
    });
  }

  const { expenseId, notifyDetails, email: _ignoredEmail, ...rest } = body;
  const $set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if ("expenseId" in body) {
    if (expenseId) $set.expenseId = new ObjectId(expenseId);
    else delete $set.expenseId;
  }
  const $unset: Record<string, ""> = {
    title: "",
    comments: "",
    customLabel: "",
    customGlyph: "",
    email: "",
  };
  if ("expenseId" in body && !expenseId) {
    $unset.expenseId = "";
  }

  const details = reminderDetailsUpdate({
    details: notifyDetails,
    notify: body.notify ?? existing.notify,
  });
  if (details.set) $set.notifyDetails = details.set;
  if (details.unset) $unset.notifyDetails = "";

  const updated = await events.findOneAndUpdate(
    { _id: new ObjectId(id.data), accountId },
    { $set, $unset },
    { returnDocument: "after" },
  );

  if (!updated) notFound("Event not found");
  if (body.notify === true) {
    void sendEventConfirmation(updated).catch((err) =>
      console.error("[reminders] confirmation email failed:", err),
    );
  }
  if (updated.notify) {
    void sendImmediateReminderIfDue(updated).catch((err) =>
      console.error("[reminders] immediate reminder failed:", err),
    );
  }
  return c.json({ event: serializeDoc(updated) });
});

eventsRoutes.delete("/:id", zValidator("query", deleteScopeQuerySchema), async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Event not found");

  const { scope, fromDate } = c.req.valid("query");
  const { events } = getCollections(getDb());
  const doc = await events.findOne({
    _id: new ObjectId(id.data),
    accountId,
  });
  if (!doc) notFound("Event not found");

  const repeating = doc.repeat && doc.repeat !== "once";
  const effectiveScope = repeating ? (scope ?? "all") : "all";
  const effectiveFrom = fromDate ?? doc.date;

  if (!repeating || effectiveScope === "all") {
    const result = await events.deleteOne({
      _id: doc._id,
      accountId,
    });
    if (result.deletedCount === 0) notFound("Event not found");
    await clearReminderLogsForEvent(doc._id);
    return c.json({ ok: true, deleted: true });
  }

  const action = resolveEventDeleteAction(effectiveScope, doc.date, effectiveFrom);

  if (action.type === "delete") {
    const result = await events.deleteOne({
      _id: doc._id,
      accountId,
    });
    if (result.deletedCount === 0) notFound("Event not found");
    await clearReminderLogsForEvent(doc._id);
    return c.json({ ok: true, deleted: true });
  }

  if (action.type === "except") {
    const updated = await events.findOneAndUpdate(
      { _id: doc._id, accountId },
      {
        $addToSet: { exceptDates: action.date },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: "after" },
    );
    if (!updated) notFound("Event not found");
    return c.json({ ok: true, deleted: false, event: serializeDoc(updated) });
  }

  const updated = await events.findOneAndUpdate(
    { _id: doc._id, accountId },
    {
      $set: { until: action.until, updatedAt: new Date() },
    },
    { returnDocument: "after" },
  );
  if (!updated) notFound("Event not found");
  return c.json({ ok: true, deleted: false, event: serializeDoc(updated) });
});
