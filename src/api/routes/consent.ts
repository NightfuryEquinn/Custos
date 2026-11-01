import { notFound } from "@/api/lib/errors";
import { serializeDoc } from "@/api/lib/serialize";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb } from "@/db";
import { updateConsentSchema } from "@/schemas/consent";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ObjectId } from "mongodb";

export const consentRoutes = new Hono<{ Variables: SessionVariables }>();

consentRoutes.use("*", sessionAuth);
consentRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

/** Load or create the third-party consent record for an account. */
async function getOrCreateConsent(accountId: string) {
  const { consent } = getCollections(getDb());
  const existing = await consent.findOne({ accountId });
  if (existing) return existing;

  const now = new Date();
  /* Upsert, not insert: two concurrent first loads would otherwise race the
     unique accountId index into E11000. */
  await consent.updateOne(
    { accountId },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        accountId,
        optedIn: false,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );

  const created = await consent.findOne({ accountId });
  if (!created) throw new Error("Failed to create consent record");
  return created;
}

consentRoutes.get("/", async (c) => {
  const accountId = c.get("accountId");
  const record = await getOrCreateConsent(accountId);
  return c.json({ consent: serializeDoc(record) });
});

consentRoutes.patch("/", zValidator("json", updateConsentSchema), async (c) => {
  const accountId = c.get("accountId");
  const { optedIn } = c.req.valid("json");
  const { consent } = getCollections(getDb());

  await getOrCreateConsent(accountId);

  const updated = await consent.findOneAndUpdate(
    { accountId },
    { $set: { optedIn, updatedAt: new Date() } },
    { returnDocument: "after" },
  );

  if (!updated) notFound("Consent record not found");
  return c.json({ consent: serializeDoc(updated) });
});
