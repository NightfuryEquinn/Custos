import { notFound } from "@/api/lib/errors";
import { randomObjectId } from "@/api/lib/ids";
import { insertOwned } from "@/api/lib/insert-idempotent";
import { accountTimezone, nudgeColumns } from "@/api/lib/nudges";
import { serializeDoc, serializeDocs } from "@/api/lib/serialize";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb } from "@/db";
import { objectIdSchema } from "@/schemas/ids";
import { createNudgeSchema, updateNudgeSchema } from "@/schemas/nudge";
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
    { _id: new ObjectId(id.data), accountId },
    {
      $set: { enc: body.enc, payload: body.payload, ...set, updatedAt: new Date() },
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
    { returnDocument: "after" },
  );

  if (!updated) notFound("Nudge not found");

  return c.json({ nudge: serializeDoc(updated) });
});

nudgesRoutes.delete("/:id", async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Nudge not found");

  const { nudges } = getCollections(getDb());
  const result = await nudges.deleteOne({ _id: new ObjectId(id.data), accountId });
  if (result.deletedCount === 0) notFound("Nudge not found");

  return c.json({ ok: true });
});
