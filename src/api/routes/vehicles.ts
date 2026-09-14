import { notFound } from "@/api/lib/errors";
import { randomObjectId } from "@/api/lib/ids";
import { insertOwned } from "@/api/lib/insert-idempotent";
import { applyDateIdCursor, pageCursorFromDocs } from "@/api/lib/pagination";
import { serializeDoc, serializeDocs } from "@/api/lib/serialize";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb } from "@/db";
import { objectIdSchema } from "@/schemas/common";
import {
  createVehicleFillSchema,
  createVehicleSchema,
  listVehicleFillsQuerySchema,
  updateVehicleFillSchema,
  updateVehicleSchema,
} from "@/schemas/vehicle";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ObjectId } from "mongodb";

export const vehiclesRoutes = new Hono<{ Variables: SessionVariables }>();

vehiclesRoutes.use("*", sessionAuth);

vehiclesRoutes.get("/", async (c) => {
  const accountId = c.get("accountId");
  const { vehicles } = getCollections(getDb());
  const docs = await vehicles.find({ accountId }).sort({ createdAt: 1 }).toArray();
  return c.json({ vehicles: serializeDocs(docs) });
});

vehiclesRoutes.post("/", zValidator("json", createVehicleSchema), async (c) => {
  const accountId = c.get("accountId");
  const body = c.req.valid("json");
  const { vehicles } = getCollections(getDb());
  const now = new Date();

  const { doc, created } = await insertOwned(vehicles, {
    _id: body.id ? new ObjectId(body.id) : randomObjectId(),
    accountId,
    type: body.type,
    enc: body.enc,
    payload: body.payload,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ vehicle: serializeDoc(doc) }, created ? 201 : 200);
});

vehiclesRoutes.patch("/:id", zValidator("json", updateVehicleSchema), async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Vehicle not found");

  const body = c.req.valid("json");
  const { vehicles } = getCollections(getDb());

  const updated = await vehicles.findOneAndUpdate(
    { _id: new ObjectId(id.data), accountId },
    {
      $set: {
        ...(body.type ? { type: body.type } : {}),
        enc: body.enc,
        payload: body.payload,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) notFound("Vehicle not found");
  return c.json({ vehicle: serializeDoc(updated) });
});

vehiclesRoutes.delete("/:id", async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Vehicle not found");

  const { vehicles, vehicleFills } = getCollections(getDb());
  const result = await vehicles.deleteOne({
    _id: new ObjectId(id.data),
    accountId,
  });

  if (result.deletedCount === 0) notFound("Vehicle not found");

  /* Fills are meaningless without their vehicle — cascade the delete. */
  await vehicleFills.deleteMany({ accountId, vehicleId: new ObjectId(id.data) });

  return c.json({ ok: true });
});

vehiclesRoutes.get("/fills", zValidator("query", listVehicleFillsQuerySchema), async (c) => {
  const accountId = c.get("accountId");
  const { vehicleId, from, limit, before, beforeId } = c.req.valid("query");
  const { vehicleFills } = getCollections(getDb());

  const filter: Record<string, unknown> = { accountId };
  if (vehicleId) filter.vehicleId = new ObjectId(vehicleId);

  const dateFilter: Record<string, string> = {};
  if (from) dateFilter.$gte = from;
  if (Object.keys(dateFilter).length) filter.date = dateFilter;

  applyDateIdCursor(filter, before, beforeId);

  const docs = await vehicleFills.find(filter).sort({ date: -1, _id: -1 }).limit(limit).toArray();
  const { hasMore, nextBefore, nextBeforeId } = pageCursorFromDocs(docs, limit);

  return c.json({
    fills: serializeDocs(docs),
    hasMore,
    nextBefore,
    nextBeforeId,
  });
});

vehiclesRoutes.post("/fills", zValidator("json", createVehicleFillSchema), async (c) => {
  const accountId = c.get("accountId");
  const body = c.req.valid("json");
  const { vehicles, vehicleFills } = getCollections(getDb());
  const now = new Date();

  const vehicle = await vehicles.findOne({ _id: new ObjectId(body.vehicleId), accountId });
  if (!vehicle) notFound("Vehicle not found");

  const { doc, created } = await insertOwned(vehicleFills, {
    _id: body.id ? new ObjectId(body.id) : randomObjectId(),
    accountId,
    vehicleId: new ObjectId(body.vehicleId),
    date: body.date,
    partial: body.partial,
    ...(body.expenseId ? { expenseId: new ObjectId(body.expenseId) } : {}),
    enc: body.enc,
    payload: body.payload,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ fill: serializeDoc(doc) }, created ? 201 : 200);
});

vehiclesRoutes.patch("/fills/:id", zValidator("json", updateVehicleFillSchema), async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Fill not found");

  const body = c.req.valid("json");
  const { vehicleFills } = getCollections(getDb());

  const set: Record<string, unknown> = {
    enc: body.enc,
    payload: body.payload,
    updatedAt: new Date(),
  };
  if (body.vehicleId) set.vehicleId = new ObjectId(body.vehicleId);
  if (body.date) set.date = body.date;
  if (body.partial !== undefined) set.partial = body.partial;

  const unset: Record<string, ""> = {};
  if (body.expenseId === null) unset.expenseId = "";
  else if (body.expenseId) set.expenseId = new ObjectId(body.expenseId);

  const updated = await vehicleFills.findOneAndUpdate(
    { _id: new ObjectId(id.data), accountId },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: "after" },
  );

  if (!updated) notFound("Fill not found");
  return c.json({ fill: serializeDoc(updated) });
});

vehiclesRoutes.delete("/fills/:id", async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Fill not found");

  const { vehicleFills } = getCollections(getDb());
  const result = await vehicleFills.deleteOne({
    _id: new ObjectId(id.data),
    accountId,
  });

  if (result.deletedCount === 0) notFound("Fill not found");
  return c.json({ ok: true });
});
