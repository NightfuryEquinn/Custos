import { expect, test } from "bun:test";
import { applySavedExpense } from "@/frontend/lib/stats";
import type { Expense } from "@/frontend/lib/types";

const row = (id: string, date: string, extra: Partial<Expense> = {}): Expense => ({
  id,
  walletId: "w1",
  kind: "expense",
  date,
  sub: "s1",
  amount: 10,
  note: id,
  recurring: false,
  ...extra,
});

test("a new row is inserted and the list stays sorted newest first", () => {
  const prev = [row("a", "2026-10-10"), row("b", "2026-10-01")];
  const next = applySavedExpense(prev, row("c", "2026-10-05"));
  expect(next.map((e) => e.id)).toEqual(["a", "c", "b"]);
});

test("an edit replaces its row instead of duplicating it", () => {
  const prev = [row("a", "2026-10-10"), row("b", "2026-10-01")];
  const next = applySavedExpense(prev, row("b", "2026-10-01", { amount: 99 }));
  expect(next).toHaveLength(2);
  expect(next.find((e) => e.id === "b")?.amount).toBe(99);
});

test("folding the same saved row in twice does not duplicate it", () => {
  const withdrawal = row("w", "2026-10-14", { kind: "income", sub: "s2", amount: 40 });
  const once = applySavedExpense([row("a", "2026-10-10")], withdrawal);
  const twice = applySavedExpense(once, withdrawal);
  expect(twice.filter((e) => e.id === "w")).toHaveLength(1);
});

test("server-deleted rows are dropped and ended recurring rows stop recurring", () => {
  const prev = [
    row("a", "2026-10-10"),
    row("gone", "2026-10-09"),
    row("series", "2026-10-08", { recurring: "monthly" }),
  ];
  const next = applySavedExpense(prev, row("new", "2026-10-11"), ["gone"], ["series"]);
  expect(next.map((e) => e.id)).toEqual(["new", "a", "series"]);
  expect(next.find((e) => e.id === "series")?.recurring).toBe(false);
});
