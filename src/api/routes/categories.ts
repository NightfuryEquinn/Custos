import { notFound } from "@/api/lib/errors";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb } from "@/db";
import { updateCategoriesSchema } from "@/schemas/category";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

export const categoriesRoutes = new Hono<{ Variables: SessionVariables }>();

categoriesRoutes.use("*", sessionAuth);

/**
 * Return the user's taxonomy as enc/payload, legacy plaintext categories,
 * or { seed: true } when no document exists yet.
 */
categoriesRoutes.get("/", async (c) => {
  const accountId = c.get("accountId");
  const { categoryTaxonomies } = getCollections(getDb());
  const taxonomy = await categoryTaxonomies.findOne({ accountId });

  if (!taxonomy) {
    return c.json({ seed: true });
  }

  if (taxonomy.enc === 1 && taxonomy.payload) {
    return c.json({ enc: taxonomy.enc, payload: taxonomy.payload });
  }

  return c.json({ categories: taxonomy.categories ?? [] });
});

/**
 * Upsert encrypted category taxonomy; clears legacy plaintext `categories`.
 */
categoriesRoutes.put("/", zValidator("json", updateCategoriesSchema), async (c) => {
  const accountId = c.get("accountId");
  const { enc, payload } = c.req.valid("json");
  const { categoryTaxonomies } = getCollections(getDb());
  const now = new Date();

  const patch = {
    $set: { enc, payload, updatedAt: now },
    $unset: { categories: "" as const },
  };

  try {
    const updated = await categoryTaxonomies.findOneAndUpdate(
      { accountId },
      { ...patch, $setOnInsert: { accountId, createdAt: now } },
      { upsert: true, returnDocument: "after" },
    );

    if (!updated) notFound("Category taxonomy not found");

    return c.json({ enc: updated.enc, payload: updated.payload });
  } catch (err) {
    /* Two first-saves can race the unique accountId index the same way
       getOrCreateProfile does — retry as a plain update of the winner. */
    if ((err as { code?: number }).code !== 11000) throw err;

    const updated = await categoryTaxonomies.findOneAndUpdate({ accountId }, patch, {
      returnDocument: "after",
    });

    if (!updated) notFound("Category taxonomy not found");

    return c.json({ enc: updated.enc, payload: updated.payload });
  }
});
