import { badRequest, notFound } from "@/api/lib/errors";
import { idForms, randomObjectId } from "@/api/lib/ids";
import { insertOwned } from "@/api/lib/insert-idempotent";
import { serializeDoc, serializeDocs } from "@/api/lib/serialize";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb } from "@/db";
import { objectIdSchema } from "@/schemas/common";
import { e2eeVersionSchema, encryptedPayloadSchema } from "@/schemas/encryption";
import { createWalletSchema, updateWalletSchema, type CreateWalletInput } from "@/schemas/wallet";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { z } from "zod";

const encryptedBudgetsSchema = z.object({
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
});

export const walletsRoutes = new Hono<{ Variables: SessionVariables }>();

walletsRoutes.use("*", sessionAuth);

/** Seed fields for a new financial wallet (name lives in E2EE payload). */
function walletSeed(
  accountId: string,
  currency: CreateWalletInput["currency"] = "MYR",
  isDefault = true,
) {
  return {
    accountId,
    name: "Main",
    currency,
    fundingMode: "monthly" as const,
    isDefault,
  };
}

async function migrateLegacyData(accountId: string) {
  const { financialWallets, expenses } = getCollections(getDb());
  const existing = await financialWallets.find({ accountId }).toArray();
  if (existing.length > 0) return existing;

  const now = new Date();
  let insertedId: ObjectId;
  try {
    const result = await financialWallets.insertOne({
      _id: randomObjectId(),
      ...walletSeed(accountId),
      createdAt: now,
      updatedAt: now,
    });
    insertedId = result.insertedId;
  } catch (err) {
    /* Check-then-act race: two requests for the same never-migrated account
       (e.g. a page load and a queue drain firing at once on reconnect) can
       both see zero wallets and both reach this insertOne. The
       `{accountId, isDefault:true}` partial unique index (src/db/indexes.ts)
       lets exactly one land; the loser re-reads instead of creating a
       second default wallet. */
    if ((err as { code?: number }).code !== 11000) throw err;
    const winner = await financialWallets.find({ accountId }).toArray();
    if (winner.length > 0) return winner;
    throw err;
  }

  await expenses.updateMany(
    { accountId, walletId: { $exists: false } },
    { $set: { walletId: insertedId } },
  );

  await financialWallets.updateMany(
    { accountId, fundingMode: { $exists: false } },
    { $set: { fundingMode: "monthly" } },
  );

  await expenses.updateMany({ accountId, kind: { $exists: false } }, { $set: { kind: "expense" } });

  const created = await financialWallets.findOne({ _id: insertedId });
  return created ? [created] : [];
}

async function getUserWallets(accountId: string) {
  const wallets = await migrateLegacyData(accountId);
  const { financialWallets, expenses } = getCollections(getDb());
  await financialWallets.updateMany(
    { accountId, fundingMode: { $exists: false } },
    { $set: { fundingMode: "monthly" } },
  );
  await expenses.updateMany({ accountId, kind: { $exists: false } }, { $set: { kind: "expense" } });
  if (wallets.length > 0) {
    return financialWallets.find({ accountId }).sort({ createdAt: 1 }).toArray();
  }

  return financialWallets.find({ accountId }).sort({ createdAt: 1 }).toArray();
}

async function findOwnedWallet(accountId: string, walletId: string) {
  const { financialWallets } = getCollections(getDb());
  return financialWallets.findOne({
    _id: new ObjectId(walletId),
    accountId,
  });
}

walletsRoutes.get("/", async (c) => {
  const accountId = c.get("accountId");
  const wallets = await getUserWallets(accountId);
  return c.json({ wallets: serializeDocs(wallets) });
});

walletsRoutes.post("/", zValidator("json", createWalletSchema), async (c) => {
  const accountId = c.get("accountId");
  const body = c.req.valid("json");
  const { financialWallets } = getCollections(getDb());

  await migrateLegacyData(accountId);

  const count = await financialWallets.countDocuments({ accountId });
  const now = new Date();

  const { doc, created } = await insertOwned(financialWallets, {
    _id: body.id ? new ObjectId(body.id) : randomObjectId(),
    accountId,
    currency: body.currency,
    fundingMode: body.fundingMode,
    enc: body.enc,
    payload: body.payload,
    isDefault: count === 0,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ wallet: serializeDoc(doc) }, created ? 201 : 200);
});

walletsRoutes.patch("/:id", zValidator("json", updateWalletSchema), async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Wallet not found");

  const body = c.req.valid("json");
  const { financialWallets } = getCollections(getDb());

  await migrateLegacyData(accountId);

  if (body.isDefault === false) {
    const target = await findOwnedWallet(accountId, id.data);
    if (target?.isDefault) {
      badRequest("Cannot unset the default wallet. Set another wallet as default instead.");
    }
  }

  if (body.isDefault === true) {
    await financialWallets.updateMany(
      { accountId, isDefault: true },
      { $set: { isDefault: false, updatedAt: new Date() } },
    );
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.currency !== undefined) patch.currency = body.currency;
  if (body.fundingMode !== undefined) patch.fundingMode = body.fundingMode;
  if (body.isDefault !== undefined) patch.isDefault = body.isDefault;
  if ("enc" in body && body.enc === 1) {
    patch.enc = body.enc;
    patch.payload = body.payload;
  }

  const update =
    "enc" in body && body.enc === 1
      ? {
          $set: patch,
          $unset: {
            name: "" as const,
            income: "" as const,
            startingBalance: "" as const,
            budgets: "" as const,
          },
        }
      : { $set: patch };

  const updated = await financialWallets.findOneAndUpdate(
    { _id: new ObjectId(id.data), accountId },
    update,
    { returnDocument: "after" },
  );

  if (!updated) notFound("Wallet not found");
  return c.json({ wallet: serializeDoc(updated) });
});

walletsRoutes.put("/:id/budgets", zValidator("json", encryptedBudgetsSchema), async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Wallet not found");

  const body = c.req.valid("json");

  const { financialWallets } = getCollections(getDb());
  await migrateLegacyData(accountId);

  const updated = await financialWallets.findOneAndUpdate(
    { _id: new ObjectId(id.data), accountId },
    {
      $set: { enc: 1, payload: body.payload, updatedAt: new Date() },
      $unset: {
        name: "" as const,
        income: "" as const,
        startingBalance: "" as const,
        budgets: "" as const,
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) notFound("Wallet not found");
  return c.json({ wallet: serializeDoc(updated) });
});

walletsRoutes.delete("/:id", async (c) => {
  const accountId = c.get("accountId");
  const id = objectIdSchema.safeParse(c.req.param("id"));
  if (!id.success) notFound("Wallet not found");

  const { financialWallets, expenses } = getCollections(getDb());
  await migrateLegacyData(accountId);

  const doc = await findOwnedWallet(accountId, id.data);
  if (!doc) notFound("Wallet not found");

  const walletCount = await financialWallets.countDocuments({ accountId });
  if (walletCount <= 1) badRequest("Cannot delete your only wallet");

  /* Match both stored forms: a legacy string-typed walletId would not be
     counted, and the wallet would delete out from under real transactions. */
  const expenseCount = await expenses.countDocuments({
    accountId,
    walletId: { $in: idForms(id.data) },
  });
  if (expenseCount > 0) {
    badRequest("Cannot delete a wallet that has transactions. Move or delete them first.");
  }

  await financialWallets.deleteOne({ _id: new ObjectId(id.data), accountId });

  if (doc.isDefault) {
    const fallback = await financialWallets.findOne({ accountId });
    if (fallback) {
      await financialWallets.updateOne(
        { _id: fallback._id },
        { $set: { isDefault: true, updatedAt: new Date() } },
      );
    }
  }

  return c.json({ ok: true });
});
