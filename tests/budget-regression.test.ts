import { expect, test } from "bun:test";
import { replaceBudgetAllocations } from "../src/frontend/lib/calculator";
import { buildCategoryIndex } from "../src/frontend/lib/categories";
import { TODAY_ISO } from "../src/frontend/lib/data";
import { monthStats } from "../src/frontend/lib/stats";
import type { Category, LedgerEvent } from "../src/frontend/lib/types";

function category(id: string, overrides: Partial<Category> = {}): Category {
  return {
    id,
    name: id,
    color: "#000000",
    glyph: "",
    type: "expense",
    subs: [{ id: `${id}-sub`, name: "Subcategory" }],
    ...overrides,
  };
}

const wallet = { fundingMode: "starting", income: 0, startingBalance: 0 } as const;
const month = TODAY_ISO.slice(0, 7);
const categories = buildCategoryIndex([
  category("rent"),
  category("savings", { type: "savings" }),
  category("income", { type: "income" }),
  category("archived", { archived: true }),
  category("hidden", { subs: [{ id: "old-sub", name: "Old", archived: true }] }),
]);

test("replacing budgets clears blank and zero allocations, including old breakdowns", () => {
  const current = {
    budgets: { rent: 4000, savings: 40, food: 60, archived: 100 },
    subcategoryBudgets: {
      rent: { "old-rent-sub": 4000 },
      savings: { "savings-sub": 40 },
      food: { "food-sub": 60 },
      archived: { "archived-sub": 100 },
    },
  };
  const replacement = replaceBudgetAllocations(current, {
    rent: { "rent-sub": 2500, "rent-other": 3098.35 },
    savings: {},
    food: { "food-sub": 0 },
  });

  expect(replacement.budgets).toEqual({ rent: 5598.35, archived: 100 });
  expect(replacement.subcategoryBudgets).toEqual({
    rent: { "rent-sub": 2500, "rent-other": 3098.35 },
    archived: { "archived-sub": 100 },
  });
  const index = buildCategoryIndex([...categories.allCategories, category("food")]);
  expect(monthStats([], replacement.budgets, wallet, month, index).totalBudget).toBe(5598.35);
});

test("only budgets on visible spending and savings categories count toward the totals", () => {
  const stats = monthStats(
    [],
    { rent: 5000, savings: 598.35, income: 100, archived: 100, hidden: 100, missing: 100 },
    wallet,
    month,
    categories,
  );

  expect(stats.totalBudget).toBe(5598.35);
  expect(stats.spendingBudget).toBe(5000);
});

function hold(categoryId: string, amount: number): LedgerEvent {
  return {
    id: categoryId,
    title: categoryId,
    catId: "appointment",
    date: TODAY_ISO,
    allDay: true,
    time: null,
    repeat: "once",
    notify: false,
    lead: "",
    email: "",
    comments: [],
    budgetHoldEnabled: true,
    budgetHoldAmount: amount,
    budgetHoldCategoryId: categoryId,
  };
}

test("only holds on visible spending and savings categories count toward Reserved", () => {
  const stats = monthStats([], { rent: 5000 }, wallet, month, categories, [
    hold("rent", 40),
    hold("savings", 60),
    hold("income", 100),
    hold("archived", 100),
    hold("hidden", 100),
    hold("missing", 100),
  ]);

  expect(stats.totalHeld).toBe(100);
  expect(stats.totalBudget).toBe(5000);
});
