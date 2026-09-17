import { createApiApp } from "@/api/app";
import { COLLECTIONS } from "@/db/collections";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, test } from "bun:test";
import { signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

describe("GET /wallets: migrateLegacyData check-then-act race", () => {
  const memory = useMemoryDb();
  let cookie = "";

  beforeEach(async () => {
    cookie = await signIn(app);
  });

  test("a duplicate-key insert (another request already seeded the account) re-reads instead of 500ing", async () => {
    const col = memory().collection(COLLECTIONS.financialWallets);
    const originalInsertOne = col.insertOne.bind(col);
    let calls = 0;

    /* Simulates the real race: the {accountId, isDefault:true} unique index
       (src/db/indexes.ts) lets exactly one of two concurrent first-loads for
       a never-migrated account land — this stands in for that index by
       having a "winner" insert land between this request's own find() and
       its insertOne(). */
    col.insertOne = (async (doc: Record<string, unknown>) => {
      calls++;
      if (calls === 1) {
        await originalInsertOne({
          _id: new ObjectId(),
          accountId: doc.accountId,
          name: "Main",
          currency: "MYR",
          fundingMode: "monthly",
          isDefault: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const err = new Error("E11000 duplicate key error collection: financial_wallets");
        (err as Error & { code: number }).code = 11000;
        throw err;
      }
      return originalInsertOne(doc);
    }) as typeof col.insertOne;

    const res = await app.request("/api/wallets", { headers: { cookie } });
    expect(res.status).toBe(200);
    const { wallets } = (await res.json()) as { wallets: unknown[] };
    expect(wallets).toHaveLength(1);
  });
});
