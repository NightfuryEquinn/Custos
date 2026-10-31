import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { sessionAuth, type SessionVariables } from "@/api/middleware/session";
import { getCollections, getDb, getMongoClient } from "@/db";
import { conflict, badRequest } from "@/api/lib/errors";
import {
  HISTORY_COLLECTION,
  mergeHistoryEvents,
  historyExpiry,
  validHistoryDay,
  emptyPersonalization,
  type HistoryBucket,
} from "@/lib/personalization";

export const personalizationRoutes = new Hono<{ Variables: SessionVariables }>();
personalizationRoutes.use("*", sessionAuth);
personalizationRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
const batchSchema = z.object({
  epoch: z.number().int().nonnegative(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  events: z
    .array(
      z.object({
        id: z.string().uuid(),
        payload: z
          .string()
          .min(40)
          .max(768)
          .regex(/^[A-Za-z0-9+/=]+$/),
      }),
    )
    .min(1)
    .max(20),
});
personalizationRoutes.post("/history", zValidator("json", batchSchema), async (c) => {
  const accountId = c.get("accountId"),
    body = c.req.valid("json");
  if (!validHistoryDay(body.day)) badRequest("History day expired or invalid");
  if (process.env.PERSONALIZATION_ENABLED !== "true")
    return c.json({ error: "Personalisation unavailable" }, 403);
  const buckets = getDb().collection<HistoryBucket>(HISTORY_COLLECTION);
  const result = await getMongoClient().withSession((session) =>
    session.withTransaction(async () => {
      const record = await getCollections(getDb()).consent.findOne({ accountId }, { session });
      const pref = record?.personalization ?? emptyPersonalization();
      if (!pref.enabled || pref.epoch !== body.epoch) conflict("Personalisation consent changed");
      await getCollections(getDb()).consent.updateOne(
        { accountId },
        { $inc: { personalizationSerial: 1 }, $set: { updatedAt: new Date() } },
        { session },
      );
      const filter = { accountId, epoch: body.epoch, day: body.day };
      const previous = await buckets.findOne(filter, { session });
      const { events, accepted, duplicate, dropped } = mergeHistoryEvents(
        previous?.events ?? [],
        body.events,
      );
      await buckets.updateOne(
        filter,
        { $set: { events, expiresAt: historyExpiry(body.day) } },
        { upsert: true, session },
      );
      return { accepted, duplicate, dropped };
    }),
  );
  return c.json(result!);
});
personalizationRoutes.get("/history", async (c) => {
  const record = await getCollections(getDb()).consent.findOne({ accountId: c.get("accountId") });
  const pref = record?.personalization ?? emptyPersonalization();
  const before = c.req.query("before");
  if (before && !/^\d{4}-\d{2}-\d{2}$/.test(before)) badRequest("Invalid cursor");
  const buckets = pref.enabled
    ? await getDb()
        .collection<HistoryBucket>(HISTORY_COLLECTION)
        .find({
          accountId: c.get("accountId"),
          epoch: pref.epoch,
          expiresAt: { $gt: new Date() },
          ...(before ? { day: { $lt: before } } : {}),
        })
        .sort({ day: -1 })
        .limit(8)
        .toArray()
    : [];
  return c.json({
    buckets: buckets.slice(0, 7).map(({ day, events }) => ({ day, events })),
    next: buckets.length > 7 ? buckets[6]!.day : null,
  });
});
personalizationRoutes.delete("/history", async (c) => {
  const accountId = c.get("accountId");
  await getMongoClient().withSession((session) =>
    session.withTransaction(async () => {
      await getCollections(getDb()).consent.updateOne(
        { accountId, "personalization.enabled": true },
        { $inc: { "personalization.epoch": 1 }, $set: { updatedAt: new Date() } },
        { session },
      );
      await getDb().collection(HISTORY_COLLECTION).deleteMany({ accountId }, { session });
    }),
  );
  return c.json({ ok: true });
});
