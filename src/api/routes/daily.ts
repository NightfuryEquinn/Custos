import { notFound } from "@/api/lib/errors";
import { randomObjectId } from "@/api/lib/ids";
import { insertOwned } from "@/api/lib/insert-idempotent";
import { serializeDoc, serializeDocs } from "@/api/lib/serialize";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb } from "@/db";
import {
  createDailyRoutineSchema,
  putDailyCompletionSchema,
  updateDailyRoutineSchema,
} from "@/schemas/daily";
import { objectIdSchema } from "@/schemas/ids";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ObjectId } from "mongodb";

export const dailyRoutes = new Hono<{ Variables: SessionVariables }>();

dailyRoutes.use("*", sessionAuth);
/* Ciphertext plus routine ids and dates: keep it out of the browser's HTTP cache and any shared cache. */
dailyRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

/** Midnight UTC of a moment: completion timestamps keep the day, not the time of the tick. */
const dayOf = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

dailyRoutes.get("/routines", async (c) => {
  const accountId = c.get("accountId");
  const { dailyRoutines } = getCollections(getDb());
  const docs = await dailyRoutines.find({ accountId }).sort({ createdAt: 1 }).toArray();
  return c.json({ routines: serializeDocs(docs) });
});

dailyRoutes.post("/routines", zValidator("json", createDailyRoutineSchema), async (c) => {
  const accountId = c.get("accountId");
  const body = c.req.valid("json");
  const { dailyRoutines } = getCollections(getDb());
  const now = new Date();

  const { doc, created } = await insertOwned(dailyRoutines, {
    _id: body.id ? new ObjectId(body.id) : randomObjectId(),
    accountId,
    enc: body.enc,
    payload: body.payload,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ routine: serializeDoc(doc) }, created ? 201 : 200);
});

dailyRoutes.patch("/routines/:id", zValidator("json", updateDailyRoutineSchema), async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Routine not found");

  const body = c.req.valid("json");
  const { dailyRoutines } = getCollections(getDb());
  const updated = await dailyRoutines.findOneAndUpdate(
    { _id: new ObjectId(id.data), accountId },
    { $set: { enc: body.enc, payload: body.payload, updatedAt: new Date() } },
    { returnDocument: "after" },
  );

  if (!updated) notFound("Routine not found");
  return c.json({ routine: serializeDoc(updated) });
});

/* Archiving keeps history and points; deleting an archived routine removes both, so its completions go with it. */
dailyRoutes.delete("/routines/:id", async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Routine not found");

  const { dailyRoutines, dailyCompletions } = getCollections(getDb());
  const result = await dailyRoutines.deleteOne({ _id: new ObjectId(id.data), accountId });
  if (result.deletedCount === 0) notFound("Routine not found");

  /* Completions store the routine id lower-cased (see putDailyCompletionSchema). */
  await dailyCompletions.deleteMany({ accountId, routineId: id.data.toLowerCase() });

  return c.json({ ok: true });
});

dailyRoutes.get("/completions", async (c) => {
  const accountId = c.get("accountId");
  const { dailyCompletions } = getCollections(getDb());
  /* ponytail: returns every completion; add a `from` period filter if an account's history grows large. */
  const docs = await dailyCompletions.find({ accountId }).sort({ period: 1 }).toArray();
  return c.json({ completions: serializeDocs(docs) });
});

/**
 * Idempotent set-state: the unique (accountId, routineId, period) index keeps
 * one row, and the last accepted write wins. Replays and rapid toggles can
 * never create a second row, so a period can never be rewarded twice.
 */
dailyRoutes.put("/completions", zValidator("json", putDailyCompletionSchema), async (c) => {
  const accountId = c.get("accountId");
  const body = c.req.valid("json");
  const { dailyRoutines, dailyCompletions } = getCollections(getDb());

  const routine = await dailyRoutines.findOne({ _id: new ObjectId(body.routineId), accountId });
  if (!routine) notFound("Routine not found");

  const filter = { accountId, routineId: body.routineId, period: body.period };
  /* The server can see when a row was written; day granularity is all it needs to. */
  const now = dayOf(new Date());
  const set = { enc: body.enc, payload: body.payload, updatedAt: now };

  let doc;
  try {
    doc = await dailyCompletions.findOneAndUpdate(
      filter,
      { $set: set, $setOnInsert: { _id: randomObjectId(), createdAt: now } },
      { upsert: true, returnDocument: "after" },
    );
  } catch (err) {
    /* Two first writes for the same period raced: the unique index let one insert win,
       so apply this one as a plain update to the row that now exists. */
    if ((err as { code?: number }).code !== 11000) throw err;
    doc = await dailyCompletions.findOneAndUpdate(
      filter,
      { $set: set },
      { returnDocument: "after" },
    );
  }

  if (!doc) throw new Error("Failed to save completion");
  return c.json({ completion: serializeDoc(doc) });
});
