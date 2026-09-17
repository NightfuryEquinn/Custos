import { createApiApp } from "@/api/app";
import { randomObjectId } from "@/api/lib/ids";
import { COLLECTIONS } from "@/db";
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();
const SAME_DATE = "2024-06-15";
const PAGE_SIZE = 100;

describe("expenses pagination", () => {
  const getMemory = useMemoryDb();
  let cookie = "";
  let accountId = "";
  let walletId = "";

  beforeEach(async () => {
    cookie = await signIn(app);

    const meRes = await app.request("/api/users/me", { headers: { cookie } });
    const me = (await meRes.json()) as { user: { id: string } };
    accountId = me.user.id;

    walletId = new ObjectId().toHexString();
    await getMemory()
      .collection(COLLECTIONS.financialWallets)
      .insertOne({
        _id: new ObjectId(walletId),
        accountId,
        enc: 1,
        payload: "wallet",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    const rows = Array.from({ length: 250 }, (_, i) => ({
      _id: randomObjectId(),
      accountId,
      walletId: new ObjectId(walletId),
      kind: "expense" as const,
      date: SAME_DATE,
      recurring: false,
      enc: 1,
      payload: `row-${i}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await getMemory().collection(COLLECTIONS.expenses).insertMany(rows);
  });

  test("returns every row when many share the same date", async () => {
    const seen = new Set<string>();
    let before: string | undefined;
    let beforeId: string | undefined;

    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) qs.set("before", before);
      if (beforeId) qs.set("beforeId", beforeId);

      const res = await app.request(`/api/expenses?${qs}`, { headers: { cookie } });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        expenses: Array<{ id: string }>;
        hasMore: boolean;
        nextBefore: string | null;
        nextBeforeId: string | null;
      };

      for (const row of body.expenses) seen.add(row.id);

      if (!body.hasMore) break;
      before = body.nextBefore ?? undefined;
      beforeId = body.nextBeforeId ?? undefined;
    }

    expect(seen.size).toBe(250);
  });
});
