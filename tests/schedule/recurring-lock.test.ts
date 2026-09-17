import { processDueRecurringExpenses } from "@/api/lib/recurring-expenses";
import { COLLECTIONS } from "@/db/collections";
import { ObjectId } from "mongodb";
import { describe, expect, test } from "bun:test";
import { useMemoryDb } from "../helpers/memory-db";

describe("processDueRecurringExpenses: overlap lock", () => {
  const memory = useMemoryDb();

  test("a second concurrent run is skipped instead of racing the first", async () => {
    const expenses = memory().collection(COLLECTIONS.expenses);
    const accountId = new ObjectId().toHexString();
    const walletId = new ObjectId();
    await expenses.insertOne({
      _id: new ObjectId(),
      accountId,
      walletId,
      kind: "expense",
      date: "2026-01-01",
      recurring: "monthly",
      sub: "food",
      amount: 10,
      note: "lunch",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    });

    const [first, second] = await Promise.all([
      processDueRecurringExpenses(new Date("2026-02-01T00:00:00Z")),
      processDueRecurringExpenses(new Date("2026-02-01T00:00:00Z")),
    ]);

    const results = [first, second];
    const locked = results.filter((r) => r.locked);
    const ran = results.filter((r) => !r.locked);

    /* Exactly one of the two concurrent calls does the work; the other sees
       the lock held and returns immediately instead of racing it — the
       overlap this test guards against is two runs both reading "no
       occurrence for date X yet" before either inserts. */
    expect(locked).toHaveLength(1);
    expect(ran).toHaveLength(1);
  });

  test("a later call succeeds once the lock is released", async () => {
    const expenses = memory().collection(COLLECTIONS.expenses);
    const accountId = new ObjectId().toHexString();
    const walletId = new ObjectId();
    await expenses.insertOne({
      _id: new ObjectId(),
      accountId,
      walletId,
      kind: "expense",
      date: "2026-01-01",
      recurring: "monthly",
      sub: "food",
      amount: 10,
      note: "lunch",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    });

    const first = await processDueRecurringExpenses(new Date("2026-02-01T00:00:00Z"));
    expect(first.locked).toBeUndefined();

    const second = await processDueRecurringExpenses(new Date("2026-03-01T00:00:00Z"));
    expect(second.locked).toBeUndefined();
  });
});
