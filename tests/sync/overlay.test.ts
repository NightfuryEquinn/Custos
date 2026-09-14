import { describe, expect, test } from "bun:test";
import { Wallet } from "ethers";
import {
  buildDerivationMessage,
  deriveKeyFromSignature,
  deriveSeriesHmacKeyFromSignature,
} from "@/frontend/lib/crypto/e2ee";
import {
  encodeCapitalPlanCreate,
  encodeEventCreate,
  encodeExpenseCreate,
  encodeExpenseUpdate,
  encodeTodoListCreate,
  encodeVehicleCreate,
} from "@/frontend/lib/crypto/codec";
import {
  applyOverlay,
  capitalPlanOverlay,
  eventOverlay,
  expenseOverlay,
  todoListOverlay,
  vehicleOverlay,
} from "@/frontend/lib/sync/overlay";
import type { Expense, LedgerEvent } from "@/frontend/lib/types";
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

describe("applyOverlay (expense)", () => {
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

    const result = await applyOverlay([], [entry], key, expenseOverlay);
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

    const result = await applyOverlay([base], [entry], key, expenseOverlay);
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

    const result = await applyOverlay([base], [entry], key, expenseOverlay);
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
    const result = await applyOverlay(base, [], key, expenseOverlay);
    expect(result).toBe(base);
  });
});

describe("applyOverlay (event)", () => {
  test("a pending create appears in the list, decoded through the real codec", async () => {
    const { key } = await testKeys();
    const id = "bbbbbbbbbbbbbbbbbbbbbbbb";
    const body = await encodeEventCreate(
      {
        title: "Rent",
        catId: "bill",
        date: "2026-09-01",
        allDay: true,
        time: null,
        repeat: "once",
        notify: false,
        lead: "1d",
        email: "",
        comments: [],
      },
      key,
    );
    const entry = outboxEntry({
      entity: "event",
      op: "create",
      targetId: id,
      request: { method: "POST", path: "/events", body: { id, ...body } },
    });

    const result = await applyOverlay([], [entry], key, eventOverlay);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id, title: "Rent", catId: "bill", date: "2026-09-01" });
  });

  test("a scoped delete with overlayPatch edits the row instead of removing it", async () => {
    const { key } = await testKeys();
    const base: LedgerEvent = {
      id: "existing-1",
      title: "Standup",
      catId: "bill",
      date: "2026-09-01",
      allDay: true,
      time: null,
      repeat: "daily",
      notify: false,
      lead: "1d",
      email: "",
      comments: [],
      exceptDates: [],
    };
    // Mirrors deleteEventMutation's "this" scope: a DELETE request whose
    // real effect (per resolveEventDeleteAction) is to add an except date,
    // not remove the event.
    const entry = outboxEntry({
      entity: "event",
      op: "delete",
      targetId: base.id,
      request: { method: "DELETE", path: `/events/${base.id}?scope=this` },
      overlayPatch: { exceptDates: ["2026-09-08"] },
    });

    const result = await applyOverlay([base], [entry], key, eventOverlay);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: base.id, exceptDates: ["2026-09-08"] });
  });

  test("a hard delete (no overlayPatch) removes the row as usual", async () => {
    const { key } = await testKeys();
    const base: LedgerEvent = {
      id: "existing-1",
      title: "Once-off",
      catId: "bill",
      date: "2026-09-01",
      allDay: true,
      time: null,
      repeat: "once",
      notify: false,
      lead: "1d",
      email: "",
      comments: [],
    };
    const entry = outboxEntry({
      entity: "event",
      op: "delete",
      targetId: base.id,
      request: { method: "DELETE", path: `/events/${base.id}` },
    });

    const result = await applyOverlay([base], [entry], key, eventOverlay);
    expect(result).toHaveLength(0);
  });
});

describe("applyOverlay (vehicle)", () => {
  test("overlayPatch supplies createdAt, which the request body never carries", async () => {
    const { key } = await testKeys();
    const id = "cccccccccccccccccccccccc";
    const body = await encodeVehicleCreate(
      { name: "Civic", model: "2020", type: "car", glyph: "🚗" },
      key,
    );
    const createdAt = "2026-01-01T00:00:00.000Z";
    const entry = outboxEntry({
      entity: "vehicle",
      op: "create",
      targetId: id,
      request: { method: "POST", path: "/vehicles", body: { id, ...body } },
      overlayPatch: { createdAt },
    });

    const result = await applyOverlay([], [entry], key, vehicleOverlay);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id, name: "Civic", createdAt });
  });
});

describe("applyOverlay (todoList, capitalPlan — trivial-envelope entities)", () => {
  test("todo list create round-trips through the real codec", async () => {
    const { key } = await testKeys();
    const id = "dddddddddddddddddddddddd";
    const body = await encodeTodoListCreate({ name: "Groceries", icon: "🛒" }, key);
    const entry = outboxEntry({
      entity: "todoList",
      op: "create",
      targetId: id,
      request: { method: "POST", path: "/todo-lists", body: { id, ...body } },
    });

    const result = await applyOverlay([], [entry], key, todoListOverlay);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id, name: "Groceries", icon: "🛒" });
  });

  test("capital plan create round-trips through the real codec", async () => {
    const { key } = await testKeys();
    const id = "eeeeeeeeeeeeeeeeeeeeeeee";
    const body = await encodeCapitalPlanCreate(
      { name: "Trip", glyph: "🎯", createdAt: "2026-01-01T00:00:00.000Z", items: [] },
      key,
    );
    const entry = outboxEntry({
      entity: "capitalPlan",
      op: "create",
      targetId: id,
      request: { method: "POST", path: "/capital-plans", body: { id, ...body } },
    });

    const result = await applyOverlay([], [entry], key, capitalPlanOverlay);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id, name: "Trip" });
  });
});
