import { createApiApp } from "@/api/app";
import { COLLECTIONS } from "@/db/collections";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, test } from "bun:test";
import { signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

describe("GET /profile: fetchProfile check-then-act race", () => {
  const memory = useMemoryDb();
  let cookie = "";

  beforeEach(async () => {
    cookie = await signIn(app);
  });

  test("a duplicate-key insert (another request already seeded the account) re-reads instead of 500ing", async () => {
    const col = memory().collection(COLLECTIONS.ledgerProfiles);
    const originalInsertOne = col.insertOne.bind(col);
    let calls = 0;

    /* Simulates the real race: `ledgerProfiles {accountId}` is already a
       unique index, so exactly one of two concurrent first-loads for a
       never-seeded account lands — this stands in for that index by having
       a "winner" insert land between this request's own findOne() and its
       own insertOne(). */
    col.insertOne = (async (doc: Record<string, unknown>) => {
      calls++;
      if (calls === 1) {
        await originalInsertOne({
          _id: new ObjectId(),
          accountId: doc.accountId,
          currentMonth: "2026-01",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const err = new Error("E11000 duplicate key error collection: ledger_profiles");
        (err as Error & { code: number }).code = 11000;
        throw err;
      }
      return originalInsertOne(doc);
    }) as typeof col.insertOne;

    const res = await app.request("/api/profile", { headers: { cookie } });
    expect(res.status).toBe(200);
    const { profile } = (await res.json()) as { profile: { currentMonth: string } };
    expect(profile.currentMonth).toBe("2026-01");
  });
});
