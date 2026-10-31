import { notFound } from "@/api/lib/errors";
import { serializeDoc } from "@/api/lib/serialize";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb, getMongoClient } from "@/db";
import { conflict, badRequest } from "@/api/lib/errors";
import {
  emptyPersonalization,
  PERSONALIZATION_NOTICE,
  HISTORY_COLLECTION,
} from "@/lib/personalization";
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
  return c.json({
    consent: {
      ...serializeDoc(record),
      personalization: record.personalization ?? emptyPersonalization(),
    },
    available: process.env.PERSONALIZATION_ENABLED === "true",
  });
});

consentRoutes.patch("/", zValidator("json", updateConsentSchema), async (c) => {
  const accountId = c.get("accountId");
  const { optedIn, personalization } = c.req.valid("json");
  const { consent } = getCollections(getDb());

  await getOrCreateConsent(accountId);

  if (personalization) {
    if (personalization.noticeVersion !== PERSONALIZATION_NOTICE)
      badRequest("Read the current personalisation notice");
    if (personalization.enabled && process.env.PERSONALIZATION_ENABLED !== "true")
      badRequest("Personalisation unavailable");
    await getMongoClient().withSession((session) =>
      session.withTransaction(async () => {
        const current = await consent.findOne({ accountId }, { session });
        const pref = current?.personalization ?? emptyPersonalization();
        if (pref.epoch !== personalization.expectedEpoch)
          conflict("Consent changed; refresh and retry");
        await consent.updateOne(
          { accountId },
          {
            $set: {
              personalization: {
                enabled: personalization.enabled,
                noticeVersion: PERSONALIZATION_NOTICE,
                epoch: pref.epoch + 1,
              },
              updatedAt: new Date(),
            },
          },
          { session },
        );
        await getDb().collection(HISTORY_COLLECTION).deleteMany({ accountId }, { session });
      }),
    );
    const record = await consent.findOne({ accountId });
    return c.json({ consent: serializeDoc(record!) });
  }
  if (optedIn === undefined) badRequest("No consent change supplied");

  const updated = await consent.findOneAndUpdate(
    { accountId },
    { $set: { optedIn, updatedAt: new Date() } },
    { returnDocument: "after" },
  );

  if (!updated) notFound("Consent record not found");
  return c.json({ consent: serializeDoc(updated) });
});
