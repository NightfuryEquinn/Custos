import { describe, expect, test } from "bun:test";
import { Wallet } from "ethers";
import {
  buildDerivationMessage,
  deriveKeyFromSignature,
  deriveSeriesHmacKeyFromSignature,
} from "@/frontend/lib/crypto/e2ee";
import { encodeExpenseCreate, encodeExpenseUpdate } from "@/frontend/lib/crypto/codec";
import { applyExpenseOverlay } from "@/frontend/lib/sync/overlay";
import type { Expense } from "@/frontend/lib/types";
import type { OutboxEntry } from "@/frontend/lib/sync/types";

async function testKeys() {
  const wallet = Wallet.createRandom();
  const signature = await wallet.signMessage(buildDerivationMessage(wallet.address));
  return {
    key: await deriveKeyFromSignature(signature),
    seriesKey: await deriveSeriesHmacKeyFromSignature(signature),
  };
}

function outboxEntry(overrides: Partial<OutboxEntry>): OutboxEntry {
  return {
    opId: "op-1",
    address: "0xabc",
    seq: 0,
    entity: "expense",
    op: "create",
    targetId: "target-1",
    request: { method: "POST", path: "/expenses" },
    dependsOn: [],
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("applyExpenseOverlay", () => {
  test("a pending create appears in the overlaid list, decoded", async () => {
    const { key, seriesKey } = await testKeys();
    const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const body = await encodeExpenseCreate(
      {
        walletId: "w1",
        kind: "expense",
        date: "2026-08-01",
        sub: "food-dining",
        amount: 12.5,
        note: "coffee",
        recurring: false,
      },
      key,
      seriesKey,
    );
    const entry = outboxEntry({
      op: "create",
      targetId: id,
      request: { method: "POST", path: "/expenses", body: { id, ...body } },
    });

    const result = await applyExpenseOverlay([], [entry], key);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id, sub: "food-dining", amount: 12.5, note: "coffee" });
  });

  test("a pending update merges onto the existing base row", async () => {
    const { key, seriesKey } = await testKeys();
    const base: Expense = {
      id: "existing-1",
      walletId: "w1",
      kind: "expense",
      date: "2026-08-01",
      sub: "food-dining",
      amount: 10,
      note: "lunch",
      recurring: false,
    };
    const body = await encodeExpenseUpdate(
      { sub: "food-dining", amount: 15, note: "lunch (updated)" },
      key,
      seriesKey,
    );
    const entry = outboxEntry({
      op: "update",
      targetId: base.id,
      request: { method: "PATCH", path: `/expenses/${base.id}`, body },
    });

    const result = await applyExpenseOverlay([base], [entry], key);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: base.id,
      amount: 15,
      note: "lunch (updated)",
      walletId: "w1", // untouched field preserved from base
    });
  });

  test("a pending delete removes the row from the overlaid list", async () => {
    const { key } = await testKeys();
    const base: Expense = {
      id: "existing-1",
      walletId: "w1",
      kind: "expense",
      date: "2026-08-01",
      sub: "food-dining",
      amount: 10,
      note: "lunch",
      recurring: false,
    };
    const entry = outboxEntry({
      op: "delete",
      targetId: base.id,
      request: { method: "DELETE", path: `/expenses/${base.id}` },
    });

    const result = await applyExpenseOverlay([base], [entry], key);
    expect(result).toHaveLength(0);
  });

  test("returns base unchanged when there are no expense entries", async () => {
    const { key } = await testKeys();
    const base: Expense[] = [
      {
        id: "1",
        walletId: "w1",
        kind: "expense",
        date: "2026-08-01",
        sub: "food-dining",
        amount: 10,
        note: "",
        recurring: false,
      },
    ];
    const result = await applyExpenseOverlay(base, [], key);
    expect(result).toBe(base);
  });
});
