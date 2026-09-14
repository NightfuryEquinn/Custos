import { notFound } from "@/api/lib/errors";
import { idForms, randomObjectId } from "@/api/lib/ids";
import { insertOwned } from "@/api/lib/insert-idempotent";
import { serializeDoc, serializeDocs } from "@/api/lib/serialize";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb } from "@/db";
import { objectIdSchema } from "@/schemas/common";
import { createCapitalPlanSchema, updateCapitalPlanSchema } from "@/schemas/capital-plan";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ObjectId } from "mongodb";

export const capitalPlansRoutes = new Hono<{ Variables: SessionVariables }>();

capitalPlansRoutes.use("*", sessionAuth);

capitalPlansRoutes.get("/", async (c) => {
  const accountId = c.get("accountId");
  const { capitalPlans } = getCollections(getDb());
  const docs = await capitalPlans.find({ accountId }).sort({ createdAt: 1 }).toArray();
  return c.json({ capitalPlans: serializeDocs(docs) });
});

capitalPlansRoutes.post("/", zValidator("json", createCapitalPlanSchema), async (c) => {
  const accountId = c.get("accountId");
  const body = c.req.valid("json");
  const { capitalPlans } = getCollections(getDb());
  const now = new Date();

  const { doc, created } = await insertOwned(capitalPlans, {
    _id: body.id ? new ObjectId(body.id) : randomObjectId(),
    accountId,
    enc: body.enc,
    payload: body.payload,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ capitalPlan: serializeDoc(doc) }, created ? 201 : 200);
});

capitalPlansRoutes.patch("/:id", zValidator("json", updateCapitalPlanSchema), async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Plan not found");

  const body = c.req.valid("json");
  const { capitalPlans } = getCollections(getDb());

  const updated = await capitalPlans.findOneAndUpdate(
    { _id: new ObjectId(id.data), accountId },
    { $set: { enc: body.enc, payload: body.payload, updatedAt: new Date() } },
    { returnDocument: "after" },
  );

  if (!updated) notFound("Plan not found");
  return c.json({ capitalPlan: serializeDoc(updated) });
});

capitalPlansRoutes.delete("/:id", async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Plan not found");

  const { capitalPlans, expenses } = getCollections(getDb());
  const result = await capitalPlans.deleteOne({
    _id: new ObjectId(id.data),
    accountId,
  });

  if (result.deletedCount === 0) notFound("Plan not found");

  /* Deposits assigned to the plan outlive it — release them back to their
     savings envelope. A dangling capitalPlanId fails both the piggy exclusion
     (a truthiness check) and every plan's inclusion test (id equality), so the
     money would count nowhere at all. */
  await expenses.updateMany(
    { accountId, capitalPlanId: { $in: idForms(id.data) } },
    { $set: { updatedAt: new Date() }, $unset: { capitalPlanId: "" } },
  );

  return c.json({ ok: true });
});
