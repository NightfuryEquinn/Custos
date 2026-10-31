import { describe, expect, test } from "bun:test";
import { historyExpiry, validHistoryDay, mergeHistoryEvents } from "./personalization";
import { generateSuggestions } from "../frontend/lib/recommendations";
import { buildCategoryIndex } from "../frontend/lib/categories";
import type { useLedger } from "../frontend/lib/hooks/useLedger";
import { rankSuggestions, type Suggestion } from "../frontend/lib/recommendations";
import type { BehaviourEvent } from "../frontend/lib/personalization-client";
import { encryptJson, decryptJson } from "../frontend/lib/crypto/e2ee";
const now = Date.parse("2026-10-31T12:00:00Z");
const candidate = (id: string, domain = "daily", priority = 0, score = 0.5): Suggestion => ({
  id,
  domain,
  priority,
  score,
  title: id,
  reason: "test",
  target: { kind: "page", view: "daily", id },
});
const event = (
  type: BehaviourEvent["type"],
  candidate = "a",
  at = "2026-10-31T10:00:00Z",
): BehaviourEvent => ({
  id: crypto.randomUUID(),
  epoch: 1,
  type,
  candidate,
  at,
  domain: "daily",
  engine: 1,
});
describe("private recommendations", () => {
  test("bucket quota is bounded and retries deduplicate even when full", () => {
    const previous = Array.from({ length: 59 }, (_, i) => ({
      id: String(i),
      payload: "x".repeat(768),
    }));
    const result = mergeHistoryEvents(previous, [
      previous[0]!,
      { id: "new", payload: "y" },
      { id: "over", payload: "z" },
      { id: "new", payload: "y" },
    ]);
    expect(result.events).toHaveLength(60);
    expect(result.accepted).toEqual(["new"]);
    expect(result.duplicate).toEqual(["0", "new"]);
    expect(result.dropped).toEqual(["over"]);
    expect(JSON.stringify(result.events).length).toBeLessThan(64 * 1024);
  });
  test("budget holds count once, other wallets stay separate, incomplete history suppresses money", () => {
    const categoryIndex = buildCategoryIndex([
      {
        id: "food",
        name: "Food",
        color: "red",
        glyph: "food",
        type: "expense",
        subs: [{ id: "lunch", name: "Lunch" }],
      },
    ]);
    const expense = {
      id: "e",
      walletId: "w",
      kind: "expense",
      date: "2026-10-30",
      sub: "lunch",
      amount: 70,
      note: "",
      recurring: false,
    };
    const ledger = {
      activeWallet: { id: "w", budgets: { food: 100 } },
      financialHistoryComplete: true,
      categoryIndex,
      accountExpenses: [expense, { ...expense, id: "other", walletId: "other", amount: 999 }],
      capitalPlans: [],
      todoLists: [],
      daily: { routines: [], completions: [] },
      nudges: { nudges: [] },
      vehicles: [],
      vehicleFills: [],
    } as unknown as ReturnType<typeof useLedger>;
    const events = [
      {
        id: "bill",
        date: "2026-10-31",
        title: "Bill",
        catId: "bill",
        repeat: "once",
        allDay: true,
        time: null,
        notify: false,
        lead: "at",
        email: "",
        comments: [],
        budgetHoldEnabled: true,
        budgetHoldAmount: 20,
        budgetHoldCategoryId: "food",
      },
    ] as typeof ledger.homeEvents;
    expect(
      generateSuggestions(ledger, "2026-10-31", events).find((c) => c.domain === "budgets")?.reason,
    ).toContain("90%");
    expect(
      generateSuggestions(
        { ...ledger, financialHistoryComplete: false },
        "2026-10-31",
        events,
      ).some((c) => c.domain === "budgets"),
    ).toBe(false);
    expect(
      generateSuggestions(ledger, "2026-10-31", null).some((c) => c.domain === "budgets"),
    ).toBe(false);
    expect(
      generateSuggestions(ledger, "2026-10-31", [{ ...events[0]!, expenseId: "paid" }]).some(
        (c) => c.domain === "schedule",
      ),
    ).toBe(false);
  });
  test("nudge and routine candidate ids are stable across days so dismissals persist", () => {
    const ledger = {
      todoLists: [],
      daily: { routines: [], completions: [] },
      nudges: { nudges: [{ id: "n", title: "Water", target: 3, unit: "cups", progress: {} }] },
      vehicles: [],
      vehicleFills: [],
    } as unknown as ReturnType<typeof useLedger>;
    const day1 = generateSuggestions(ledger, "2026-10-31", null)[0]!;
    const day2 = generateSuggestions(ledger, "2026-11-01", null)[0]!;
    expect(day2.id).toBe(day1.id);
    expect(rankSuggestions([day2], [event("dismissed", day1.id)], now + 86400000)).toHaveLength(0);
  });
  test("30 UTC calendar days; invalid and future dates are rejected", () => {
    expect(validHistoryDay("2026-10-02", now)).toBe(true);
    expect(validHistoryDay("2026-10-01", now)).toBe(false);
    expect(validHistoryDay("2026-11-01", now)).toBe(false);
    expect(validHistoryDay("2026-02-30", now)).toBe(false);
    expect(historyExpiry("2026-10-02").toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
  test("feedback adjusts order but never crosses urgency tiers", () => {
    const list = [
      candidate("a"),
      candidate("b", "todos", 0, 0.52),
      candidate("urgent", "vehicles", 2, 0.1),
    ];
    expect(rankSuggestions(list, [], now).map((c) => c.id)).toEqual(["urgent", "b", "a"]);
    expect(rankSuggestions(list, [event("helpful")], now).map((c) => c.id)).toEqual([
      "urgent",
      "a",
      "b",
    ]);
  });
  test("dismissals expire after seven days and older feedback does not affect ranking", () => {
    expect(rankSuggestions([candidate("a")], [event("dismissed")], now)).toHaveLength(0);
    expect(
      rankSuggestions([candidate("a")], [event("dismissed", "a", "2026-10-23T10:00:00Z")], now),
    ).toHaveLength(1);
    expect(
      rankSuggestions([candidate("a")], [event("helpful", "a", "2026-09-01T10:00:00Z")], now)[0]
        ?.score,
    ).toBe(0.5);
  });
  test("stable ties, deduplication and domain diversity", () => {
    const list = [
      candidate("c"),
      candidate("b"),
      candidate("a"),
      candidate("a"),
      candidate("d", "todos"),
    ];
    expect(rankSuggestions(list, [], now).map((c) => c.id)).toEqual(["a", "b", "d"]);
  });
  test("history ciphertext requires the ledger key and rejects tampering", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const other = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const plain = event("helpful");
    const payload = await encryptJson(key, plain);
    expect(payload.includes("helpful")).toBe(false);
    expect(await decryptJson<BehaviourEvent>(key, payload)).toEqual(plain);
    await expect(decryptJson(other, payload)).rejects.toThrow();
    await expect(
      decryptJson(key, payload.slice(0, 30) + "AAAA" + payload.slice(34)),
    ).rejects.toThrow();
  });
});
