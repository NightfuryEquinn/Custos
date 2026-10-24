import { describe, expect, test } from "bun:test";
import {
  computeStreak,
  historicalPeriod,
  points,
  restoreRoutine,
  type DailyRoutine,
} from "../src/lib/daily";
import {
  applyNudgeCheckIn,
  goalMet,
  monthLog,
  type Nudge,
  type NudgeCheckIn,
} from "../src/lib/nudge";
import { budgetsFromAmounts, isValidAllocationAmounts } from "../src/frontend/lib/calculator";
import { transferBudgetBreakdown } from "../src/frontend/lib/subcategory-budgets";
import {
  decodeNudgeCheckIn,
  decodeWallet,
  encodeNudgeCheckIn,
  encodeWalletFinancials,
} from "../src/frontend/lib/crypto/codec";
import {
  buildBackupPlain,
  decryptBackup,
  encryptBackup,
} from "../src/frontend/auth/lib/encrypted-backup";

const routine: DailyRoutine = {
  id: "routine",
  title: "Read",
  notes: "",
  createdAt: "2026-10-01T00:00:00Z",
  schedule: [{ kind: "daily", from: "2026-10-01" }],
};
const nudge: Nudge = {
  id: "012345678901234567890123",
  title: "Water",
  description: "",
  target: 8,
  unit: "glasses",
  step: 2,
  progress: { day: "2026-10-24", count: 6 },
  history: { "2026-10-23": 4 },
  enabled: true,
  everyMin: 60,
  windowStart: "08:00",
  windowEnd: "22:00",
  createdAt: "2026-10-01T00:00:00Z",
};
const event: NudgeCheckIn = {
  id: "112345678901234567890123",
  nudgeId: nudge.id,
  at: "2026-10-24T03:00:00Z",
  day: "2026-10-24",
  change: 2,
  delta: 2,
  count: 8,
  target: 8,
  unit: "glasses",
};
const key = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

describe("Daily historical occurrences", () => {
  test("rejects future and pre-creation dates", () => {
    expect(historicalPeriod(routine, "2026-10-25", "2026-10-24")).toBeNull();
    expect(historicalPeriod(routine, "2026-09-30", "2026-10-24")).toBeNull();
    expect(historicalPeriod(routine, "2026-10-04", "2026-10-24")).toBe("2026-10-04");
  });
  test("uses the historical rule and one Monday key for a whole week", () => {
    const changed = {
      ...routine,
      schedule: [
        { kind: "weekdays" as const, from: "2026-10-01", weekdays: [0] },
        { kind: "weekly" as const, from: "2026-10-12" },
      ],
    };
    expect(historicalPeriod(changed, "2026-10-05", "2026-10-24")).toBe("2026-10-05");
    expect(historicalPeriod(changed, "2026-10-06", "2026-10-24")).toBeNull();
    expect(historicalPeriod(changed, "2026-10-18", "2026-10-24")).toBe("2026-10-12");
  });
  test("allows archived history but excludes restored pauses", () => {
    const archived = { ...routine, archivedOn: "2026-10-04" };
    expect(historicalPeriod(archived, "2026-10-03", "2026-10-24")).toBe("2026-10-03");
    expect(historicalPeriod(archived, "2026-10-05", "2026-10-24")).toBeNull();
    const restored = restoreRoutine(archived, new Set(["2026-10-04"]), "2026-10-10");
    expect(historicalPeriod(restored, "2026-10-07", "2026-10-24")).toBeNull();
    expect(historicalPeriod(restored, "2026-10-10", "2026-10-24")).toBe("2026-10-10");
  });
  test("backfill repairs a streak; undo removes its points", () => {
    const done = new Set(["2026-10-01", "2026-10-03"]);
    expect(computeStreak(routine, done, "2026-10-03").current).toBe(1);
    done.add("2026-10-02");
    expect(computeStreak(routine, done, "2026-10-03").current).toBe(3);
    const completions = [...done].map((period) => ({
      id: `routine:${period}`,
      routineId: "routine",
      period,
      at: "2026-10-24T00:00:00Z",
      done: true,
    }));
    expect(points(completions)).toBe(30);
    expect(points(completions.map((c) => ({ ...c, done: c.period !== "2026-10-02" })))).toBe(20);
  });
});

describe("Subcategory allocation", () => {
  test("supports partial allocations and rejects excess with existing cent tolerance", () => {
    expect(isValidAllocationAmounts([35, 20], 100)).toBe(true);
    expect(isValidAllocationAmounts([65, 45], 100)).toBe(false);
    expect(
      budgetsFromAmounts([
        { id: "food", amount: 12.345 },
        { id: "travel", amount: 0 },
      ]),
    ).toEqual({ food: 12.35 });
  });
  test("moves child envelopes without double-counting parent totals", () => {
    const args = {
      sourceSubIds: ["lunch"],
      destCatId: "travel",
      destSubId: "train",
      destType: "expense",
    };
    const original = { food: { lunch: 30, groceries: 70 }, travel: { train: 20 } };
    const moved = transferBudgetBreakdown({ food: 100, travel: 50 }, original, args);
    expect(moved.budgets).toEqual({ food: 70, travel: 80 });
    expect(moved.subcategoryBudgets.travel?.train).toBe(50);
    expect(original.food.lunch).toBe(30);
    expect(transferBudgetBreakdown(moved.budgets, moved.subcategoryBudgets, args)).toEqual(moved);
  });
  test("same-parent merges preserve the envelope", () => {
    const moved = transferBudgetBreakdown(
      { food: 100 },
      { food: { lunch: 30, groceries: 70 } },
      { sourceSubIds: ["lunch"], destCatId: "food", destSubId: "groceries", destType: "expense" },
    );
    expect(moved.budgets.food).toBe(100);
    expect(moved.subcategoryBudgets.food).toEqual({ groceries: 100 });
  });
  test("whole-category transfers preserve unallocated remainder and income discards allocation", () => {
    const args = {
      sourceCatId: "food",
      sourceSubIds: ["lunch"],
      destCatId: "travel",
      destSubId: "train",
      destType: "expense",
    };
    const moved = transferBudgetBreakdown({ food: 100, travel: 50 }, { food: { lunch: 30 } }, args);
    expect(moved.budgets).toEqual({ travel: 150 });
    expect(moved.subcategoryBudgets.travel).toEqual({ train: 30 });
    const income = transferBudgetBreakdown(
      { food: 100 },
      { food: { lunch: 30 } },
      { ...args, destType: "income" },
    );
    expect(income.budgets).toEqual({});
    expect(income.subcategoryBudgets).toEqual({});
  });
});

describe("Permanent Nudge check-ins", () => {
  test("reaches a goal and a decrement reopens it", () => {
    const reached = applyNudgeCheckIn(nudge, event);
    expect(goalMet(reached.nudge, event.day)).toBe(true);
    const undo = applyNudgeCheckIn(reached.nudge, { ...event, change: -2 });
    expect(goalMet(undo.nudge, event.day)).toBe(false);
    expect(undo.event.delta).toBe(-2);
  });
  test("clamps a decrement at zero and records its actual delta", () => {
    const result = applyNudgeCheckIn(
      { ...nudge, progress: { day: event.day, count: 1 } },
      { ...event, change: -2 },
    );
    expect(result.event.count).toBe(0);
    expect(result.event.delta).toBe(-1);
    expect(result.event.change).toBe(-2);
  });
  test("rebases an offline operation on its original day without replacing today's progress", () => {
    const result = applyNudgeCheckIn(nudge, { ...event, day: "2026-10-23" });
    expect(result.nudge.history?.["2026-10-23"]).toBe(6);
    expect(result.nudge.progress).toEqual(nudge.progress);
    expect(result.event.id).toBe(event.id);
    expect(result.event.at).toBe(event.at);
  });
  test("two independently composed adjustments both contribute after rebase", () => {
    const first = applyNudgeCheckIn(nudge, event);
    const second = applyNudgeCheckIn(first.nudge, { ...event, id: "212345678901234567890123" });
    expect(second.nudge.progress.count).toBe(10);
    expect(monthLog(second.nudge, "2026-10")[0]).toEqual(["2026-10-24", 10]);
  });
  test("event encryption keeps counters and goal snapshots out of the wire metadata", async () => {
    const secret = await key();
    const wire = await encodeNudgeCheckIn(event, secret);
    expect(Object.keys(wire).sort()).toEqual(["at", "day", "enc", "id", "nudgeId", "payload"]);
    expect(await decodeNudgeCheckIn(wire, secret)).toEqual(event);
  });
});

describe("Compatibility and backup", () => {
  test("wallet ciphertext round-trips both budgets and optional breakdowns", async () => {
    const secret = await key();
    const data = {
      name: "Wallet",
      income: 100,
      startingBalance: 0,
      budgets: { food: 40 },
      subcategoryBudgets: { food: { lunch: 40 } },
    };
    const encoded = await encodeWalletFinancials(data, secret);
    const decoded = await decodeWallet(
      { ...encoded, id: "wallet", currency: "MYR", fundingMode: "monthly", isDefault: true },
      secret,
    );
    expect(decoded.subcategoryBudgets).toEqual(data.subcategoryBudgets);
    expect(decoded.budgets).toEqual(data.budgets);
  });
  test("new optional Nudge fields survive encrypted backup without changing format", async () => {
    const secret = await key();
    const plain = buildBackupPlain({
      address: "account",
      wallets: [],
      categories: [],
      expenses: [],
      events: [],
      todoLists: [],
      nudges: [nudge],
      nudgeCheckIns: [event],
    });
    const restored = await decryptBackup(secret, await encryptBackup(secret, plain));
    expect(restored.nudges).toEqual([nudge]);
    expect(restored.nudgeCheckIns).toEqual([event]);
    expect(restored.version).toBe(1);
  });
});
