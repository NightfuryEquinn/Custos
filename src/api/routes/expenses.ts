import { badRequest, notFound } from "@/api/lib/errors";
import {
  applyExpenseDeleteScope,
  retireOldExpenseSeries,
  shouldRetireOldExpenseSeries,
} from "@/api/lib/expense-delete-scope";
import { buildExpenseUpdate } from "@/api/lib/expense-update";
import { idForms, randomObjectId } from "@/api/lib/ids";
import { insertOwned } from "@/api/lib/insert-idempotent";
import { applyDateIdCursor, pageCursorFromDocs } from "@/api/lib/pagination";
import { serializeDoc, serializeDocs } from "@/api/lib/serialize";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb } from "@/db";
import { deleteScopeQuerySchema } from "@/lib/delete-scope";
import { normalizeRecurring } from "@/lib/recurring";
import { monthDateBounds, objectIdSchema } from "@/schemas/common";
import {
  createExpenseSchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
} from "@/schemas/expense";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ObjectId } from "mongodb";

export const expensesRoutes = new Hono<{ Variables: SessionVariables }>();

expensesRoutes.use("*", sessionAuth);

expensesRoutes.get("/", zValidator("query", listExpensesQuerySchema), async (c) => {
  const accountId = c.get("accountId");
  const { month, recurring, walletId, kind, from, to, limit, before, beforeId } =
    c.req.valid("query");
  const { expenses } = getCollections(getDb());

  const filter: Record<string, unknown> = {
    accountId,
    skipped: { $ne: true },
  };
  if (walletId) filter.walletId = new ObjectId(walletId);
  if (kind) filter.kind = kind;

  const dateFilter: Record<string, string> = {};
  if (month) {
    const bounds = monthDateBounds(month);
    dateFilter.$gte = bounds.$gte;
    dateFilter.$lte = bounds.$lte;
  } else {
    if (from) dateFilter.$gte = from;
    if (to) dateFilter.$lte = to;
  }
  if (Object.keys(dateFilter).length) filter.date = dateFilter;

  applyDateIdCursor(filter, before, beforeId);

  if (recurring === true) {
    filter.recurring = { $in: [true, "monthly", "quarterly", "yearly"] };
  } else if (recurring === false) {
    filter.recurring = false;
  }

  const docs = await expenses.find(filter).sort({ date: -1, _id: -1 }).limit(limit).toArray();
  const { hasMore, nextBefore, nextBeforeId } = pageCursorFromDocs(docs, limit);

  return c.json({
    expenses: serializeDocs(docs),
    hasMore,
    nextBefore,
    nextBeforeId,
  });
});

expensesRoutes.post("/", zValidator("json", createExpenseSchema), async (c) => {
  const accountId = c.get("accountId");
  const body = c.req.valid("json");
  const now = new Date();
  const { expenses, financialWallets } = getCollections(getDb());

  const wallet = await financialWallets.findOne({
    _id: new ObjectId(body.walletId),
    accountId,
  });
  if (!wallet) notFound("Wallet not found");

  if (body.recurring !== false && !body.seriesKey) {
    badRequest("seriesKey is required for encrypted recurring expenses");
  }

  const { doc, created } = await insertOwned(expenses, {
    _id: body.id ? new ObjectId(body.id) : randomObjectId(),
    accountId,
    walletId: new ObjectId(body.walletId),
    kind: body.kind ?? "expense",
    date: body.date,
    recurring: body.recurring,
    enc: body.enc,
    payload: body.payload,
    seriesKey: body.seriesKey,
    ...(body.eventId ? { eventId: new ObjectId(body.eventId) } : {}),
    ...(body.capitalPlanId ? { capitalPlanId: new ObjectId(body.capitalPlanId) } : {}),
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ expense: serializeDoc(doc) }, created ? 201 : 200);
});

expensesRoutes.patch("/:id", zValidator("json", updateExpenseSchema), async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Expense not found");

  const body = c.req.valid("json");
  const { expenses, financialWallets } = getCollections(getDb());

  if (body.walletId) {
    const wallet = await financialWallets.findOne({
      _id: new ObjectId(body.walletId),
      accountId,
    });
    if (!wallet) notFound("Wallet not found");
  }

  const existing = await expenses.findOne({
    _id: new ObjectId(id.data),
    accountId,
    skipped: { $ne: true },
  });
  if (!existing) notFound("Expense not found");

  const retireOld = shouldRetireOldExpenseSeries(existing, body);
  let seriesRetire: { deletedIds: string[]; endedIds: string[] } | undefined;

  if (retireOld) {
    const pivotDate = body.date ?? existing.date;
    seriesRetire = await retireOldExpenseSeries({
      expenses,
      doc: existing,
      accountId,
      pivotDate,
    });
  }

  const update = buildExpenseUpdate(body);

  const updated = await expenses.findOneAndUpdate(
    { _id: existing._id, accountId, skipped: { $ne: true } },
    update,
    { returnDocument: "after" },
  );

  if (!updated) notFound("Expense not found");
  return c.json({
    expense: serializeDoc(updated),
    ...(seriesRetire
      ? { deletedIds: seriesRetire.deletedIds, endedIds: seriesRetire.endedIds }
      : {}),
  });
});

expensesRoutes.delete("/:id", zValidator("query", deleteScopeQuerySchema), async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Expense not found");

  const { scope, fromDate } = c.req.valid("query");
  const { expenses, events, vehicleFills } = getCollections(getDb());
  const doc = await expenses.findOne({
    _id: new ObjectId(id.data),
    accountId,
    skipped: { $ne: true },
  });
  if (!doc) notFound("Expense not found");

  /*
   * An event's expenseId is proof-of-payment to `isHoldReleased`, and a fill's
   * is what hides its "Log" button. Left pointing at a deleted expense, the
   * first under-reserves that budget envelope forever and the second makes the
   * payment impossible to re-log. Both fields are plaintext, so clear them here
   * rather than relying on the client, which only unlinks the single row it was
   * asked to delete and only searches the month it happens to be showing.
   */
  const unlinkDeleted = async (deletedIds: string[]) => {
    if (!deletedIds.length) return;
    const now = new Date();
    /* EventDocument.expenseId is `ObjectId | string`, so match both stored
       forms; VehicleFillDocument.expenseId is strictly ObjectId. */
    await events.updateMany(
      { accountId, expenseId: { $in: deletedIds.flatMap((hex) => idForms(hex)) } },
      { $set: { updatedAt: now }, $unset: { expenseId: "" } },
    );
    await vehicleFills.updateMany(
      { accountId, expenseId: { $in: deletedIds.map((hex) => new ObjectId(hex)) } },
      { $set: { updatedAt: now }, $unset: { expenseId: "" } },
    );
  };

  const isRecurring = normalizeRecurring(doc.recurring) !== false;

  if (!isRecurring || !scope) {
    const result = await expenses.deleteOne({
      _id: doc._id,
      accountId,
    });
    if (result.deletedCount === 0) notFound("Expense not found");
    await unlinkDeleted([doc._id.toString()]);
    return c.json({ ok: true, deletedIds: [doc._id.toString()] });
  }

  const effectiveFrom = fromDate ?? doc.date;
  const applied = await applyExpenseDeleteScope({
    expenses,
    doc,
    accountId,
    scope,
    fromDate: effectiveFrom,
  });

  /* A skipped occurrence is filtered out of every read path, so links to it are
     just as dead as links to a deleted row. `endedIds` rows still exist. */
  await unlinkDeleted([
    ...(applied.deletedIds ?? []),
    ...(applied.skippedId ? [applied.skippedId] : []),
  ]);

  return c.json({ ok: true, ...applied });
});
