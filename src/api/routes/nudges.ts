import { z } from "zod";
import { monthKeySchema, isoDateSchema } from "@/schemas/common";
import { notFound, conflict, badRequest } from "@/api/lib/errors";
import { randomObjectId } from "@/api/lib/ids";
import { insertOwned } from "@/api/lib/insert-idempotent";
import { accountTimezone, nudgeColumns } from "@/api/lib/nudges";
import { serializeDoc, serializeDocs } from "@/api/lib/serialize";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb, getMongoClient } from "@/db";
import { objectIdSchema } from "@/schemas/ids";
import {
  createNudgeSchema,
  updateNudgeSchema,
  nudgeCheckInSchema,
  recordNudgeCheckInSchema,
} from "@/schemas/nudge";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ObjectId } from "mongodb";

export const nudgesRoutes = new Hono<{ Variables: SessionVariables }>();

nudgesRoutes.use("*", sessionAuth);
/* Ciphertext plus timing and the readable push copy: keep it out of every HTTP cache. */
nudgesRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

nudgesRoutes.get("/", async (c) => {
  const accountId = c.get("accountId");
  const { nudges } = getCollections(getDb());
  const docs = await nudges.find({ accountId }).sort({ createdAt: 1 }).toArray();

  return c.json({ nudges: serializeDocs(docs) });
});

nudgesRoutes.post("/", zValidator("json", createNudgeSchema), async (c) => {
  const accountId = c.get("accountId");
  const body = c.req.valid("json");
  const { nudges } = getCollections(getDb());
  const now = new Date();
  const { set } = nudgeColumns(body, await accountTimezone(accountId), now.getTime());

  const { doc, created } = await insertOwned(nudges, {
    _id: body.id ? new ObjectId(body.id) : randomObjectId(),
    accountId,
    enc: body.enc,
    payload: body.payload,
    ...set,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ nudge: serializeDoc(doc) }, created ? 201 : 200);
});

nudgesRoutes.patch("/:id", zValidator("json", updateNudgeSchema), async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Nudge not found");

  const body = c.req.valid("json");
  const { nudges } = getCollections(getDb());
  const { set, unset } = nudgeColumns(body, await accountTimezone(accountId));
  const updated = await nudges.findOneAndUpdate(
    {
      _id: new ObjectId(id.data),
      accountId,
      ...(body.expectedRevision === undefined ? {} : revisionFilter(body.expectedRevision)),
    },
    {
      $inc: { revision: 1 },
      $set: { enc: body.enc, payload: body.payload, ...set, updatedAt: new Date() },
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
    { returnDocument: "after" },
  );

  if (!updated) {
    if (
      body.expectedRevision !== undefined &&
      (await nudges.findOne({ _id: new ObjectId(id.data), accountId }))
    )
      conflict("Nudge changed; retry");
    notFound("Nudge not found");
  }

  return c.json({ nudge: serializeDoc(updated) });
});

nudgesRoutes.delete("/:id", async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Nudge not found");

  const { nudges, nudgeCheckIns } = getCollections(getDb());
  await getMongoClient().withSession((session) =>
    session.withTransaction(async () => {
      const result = await nudges.deleteOne({ _id: new ObjectId(id.data), accountId }, { session });
      if (result.deletedCount === 0) notFound("Nudge not found");
      await nudgeCheckIns.deleteMany({ accountId, nudgeId: id.data.toLowerCase() }, { session });
    }),
  );

  return c.json({ ok: true });
});

function revisionFilter(revision: number) {
  return revision === 0
    ? { $or: [{ revision: 0 }, { revision: { $exists: false as const } }] }
    : { revision };
}
function nudgeId(raw: string) {
  const parsed = objectIdSchema.safeParse(raw);
  if (!parsed.success) notFound("Nudge not found");
  return parsed.data.toLowerCase();
}
nudgesRoutes.get("/:id", async (c) => {
  const doc = await getCollections(getDb()).nudges.findOne({
    _id: new ObjectId(nudgeId(c.req.param("id"))),
    accountId: c.get("accountId"),
  });
  if (!doc) notFound("Nudge not found");
  return c.json({ nudge: serializeDoc(doc) });
});

nudgesRoutes.get("/:id/check-ins", async (c) => {
  const accountId = c.get("accountId");
  const id = nudgeId(c.req.param("id"));
  const { nudges, nudgeCheckIns } = getCollections(getDb());
  if (!(await nudges.findOne({ _id: new ObjectId(id), accountId }))) notFound("Nudge not found");
  const query = z
    .object({
      month: monthKeySchema.optional(),
      day: isoDateSchema.optional(),
      cursor: z.string().optional(),
    })
    .safeParse(c.req.query());
  if (!query.success) badRequest("Invalid history filter");
  const { month, day, cursor } = query.data;
  /* Cursor is `day|seq|id`: the last row of the previous page, in the order below. */
  const before = cursor?.split("|");
  if (
    before &&
    (before.length !== 3 ||
      !isoDateSchema.safeParse(before[0]).success ||
      !/^-?\d+$/.test(before[1]!) ||
      !objectIdSchema.safeParse(before[2]).success)
  )
    badRequest("Invalid history cursor");
  const docs = await nudgeCheckIns
    .find({
      accountId,
      nudgeId: id,
      ...(day ? { day } : month ? { day: { $gte: `${month}-01`, $lte: `${month}-31` } } : {}),
      ...(before
        ? {
            $or: [
              { day: { $lt: before[0]! } },
              { day: before[0]!, seq: { $lt: Number(before[1]) } },
              { day: before[0]!, seq: Number(before[1]), _id: { $lt: new ObjectId(before[2]!) } },
            ],
          }
        : {}),
    })
    .sort({ day: -1, seq: -1, _id: -1 })
    .limit(51)
    .toArray();
  const page = docs.slice(0, 50);
  const last = page.at(-1);
  return c.json({
    events: serializeDocs(page),
    cursor:
      docs.length > 50 && last ? `${last.day}|${last.seq ?? 0}|${last._id.toHexString()}` : null,
  });
});

nudgesRoutes.post("/:id/check-ins", zValidator("json", recordNudgeCheckInSchema), async (c) => {
  const accountId = c.get("accountId");
  const id = nudgeId(c.req.param("id"));
  const body = c.req.valid("json");
  const { nudges, nudgeCheckIns } = getCollections(getDb());
  const { set, unset } = nudgeColumns(body.nudge, await accountTimezone(accountId));
  const result = await getMongoClient().withSession((session) =>
    session.withTransaction(async () => {
      const current = await nudges.findOne({ _id: new ObjectId(id), accountId }, { session });
      if (!current) notFound("Nudge not found");
      const existing = await nudgeCheckIns.findOne({ _id: new ObjectId(body.id) }, { session });
      if (existing) {
        if (existing.accountId !== accountId || existing.nudgeId !== id)
          conflict("Check-in id already in use");
        return { nudge: serializeDoc(current), event: serializeDoc(existing) };
      }
      if ((current.revision ?? 0) !== body.expectedRevision) conflict("Nudge changed; retry");
      const updated = await nudges.findOneAndUpdate(
        { _id: current._id, accountId, ...revisionFilter(body.expectedRevision) },
        {
          /* No updatedAt here: it would record the time of every tap in the clear. */
          $set: { enc: body.nudge.enc, payload: body.nudge.payload, ...set },
          $inc: { revision: 1 },
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
        },
        { session, returnDocument: "after" },
      );
      if (!updated) conflict("Nudge changed; retry");
      const event = {
        _id: new ObjectId(body.id),
        accountId,
        nudgeId: id,
        day: body.day,
        seq: updated.revision ?? 0,
        enc: body.enc,
        payload: body.payload,
      };
      await nudgeCheckIns.insertOne(event, { session });
      return { nudge: serializeDoc(updated), event: serializeDoc(event) };
    }),
  );
  return c.json(result, 201);
});

// Backup restore preserves event ids and never applies their counts a second time.
nudgesRoutes.put("/:id/check-ins/:eventId", zValidator("json", nudgeCheckInSchema), async (c) => {
  const accountId = c.get("accountId");
  const id = nudgeId(c.req.param("id"));
  const body = c.req.valid("json");
  if (body.id !== c.req.param("eventId")) badRequest("Check-in id mismatch");
  const { nudges, nudgeCheckIns } = getCollections(getDb());
  await getMongoClient().withSession((session) =>
    session.withTransaction(async () => {
      if (!(await nudges.findOne({ _id: new ObjectId(id), accountId }, { session })))
        notFound("Nudge not found");
      const existing = await nudgeCheckIns.findOne({ _id: new ObjectId(body.id) }, { session });
      if (existing) {
        if (existing.accountId !== accountId || existing.nudgeId !== id)
          conflict("Check-in id already in use");
        return;
      }
      // Touch the parent to serialize against concurrent deletion; its revision orders the row.
      const touched = await nudges.findOneAndUpdate(
        { _id: new ObjectId(id), accountId },
        { $inc: { revision: 1 } },
        { session, returnDocument: "after" },
      );
      await nudgeCheckIns.insertOne(
        {
          _id: new ObjectId(body.id),
          accountId,
          nudgeId: id,
          day: body.day,
          seq: touched?.revision ?? 0,
          enc: body.enc,
          payload: body.payload,
        },
        { session },
      );
    }),
  );
  return c.json({ ok: true });
});
nudgesRoutes.patch(
  "/:id/check-ins/:eventId",
  zValidator("json", nudgeCheckInSchema.pick({ enc: true, payload: true })),
  async (c) => {
    const body = c.req.valid("json");
    const result = await getCollections(getDb()).nudgeCheckIns.updateOne(
      {
        _id: new ObjectId(nudgeId(c.req.param("eventId"))),
        accountId: c.get("accountId"),
        nudgeId: nudgeId(c.req.param("id")),
      },
      { $set: body },
    );
    if (!result.matchedCount) notFound("Check-in not found");
    return c.json({ ok: true });
  },
);
