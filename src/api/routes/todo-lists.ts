import { notFound } from "@/api/lib/errors";
import { randomObjectId } from "@/api/lib/ids";
import { insertOwned } from "@/api/lib/insert-idempotent";
import { serializeDoc, serializeDocs } from "@/api/lib/serialize";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb } from "@/db";
import { objectIdSchema } from "@/schemas/common";
import { createTodoListSchema, updateTodoListSchema } from "@/schemas/todo";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ObjectId } from "mongodb";

export const todoListsRoutes = new Hono<{ Variables: SessionVariables }>();

todoListsRoutes.use("*", sessionAuth);

todoListsRoutes.get("/", async (c) => {
  const accountId = c.get("accountId");
  const { todoLists } = getCollections(getDb());
  const docs = await todoLists.find({ accountId }).sort({ createdAt: 1 }).toArray();
  return c.json({ todoLists: serializeDocs(docs) });
});

todoListsRoutes.post("/", zValidator("json", createTodoListSchema), async (c) => {
  const accountId = c.get("accountId");
  const body = c.req.valid("json");
  const { todoLists } = getCollections(getDb());
  const now = new Date();

  const { doc, created } = await insertOwned(todoLists, {
    _id: body.id ? new ObjectId(body.id) : randomObjectId(),
    accountId,
    enc: body.enc,
    payload: body.payload,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ todoList: serializeDoc(doc) }, created ? 201 : 200);
});

todoListsRoutes.patch("/:id", zValidator("json", updateTodoListSchema), async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("List not found");

  const body = c.req.valid("json");
  const { todoLists } = getCollections(getDb());

  const updated = await todoLists.findOneAndUpdate(
    { _id: new ObjectId(id.data), accountId },
    {
      $set: { enc: body.enc, payload: body.payload, updatedAt: new Date() },
      $unset: { name: "", icon: "", tasks: "" },
    },
    { returnDocument: "after" },
  );

  if (!updated) notFound("List not found");
  return c.json({ todoList: serializeDoc(updated) });
});

todoListsRoutes.delete("/:id", async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("List not found");

  const { todoLists } = getCollections(getDb());
  const result = await todoLists.deleteOne({
    _id: new ObjectId(id.data),
    accountId,
  });

  if (result.deletedCount === 0) notFound("List not found");
  return c.json({ ok: true });
});
