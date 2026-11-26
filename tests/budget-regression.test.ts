import { expect, test } from "bun:test";
import { replaceBudgetAllocations } from "../src/frontend/lib/calculator";
import { setSubcategoryBudget } from "../src/frontend/lib/subcategory-budgets";
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

test("a category ceiling above the breakdown stays unallocated", () => {
  const replacement = replaceBudgetAllocations(
    { budgets: { rent: 100 }, subcategoryBudgets: { rent: { "rent-sub": 100 } } },
    { rent: { "rent-sub": 40, "rent-other": 10 } },
    { rent: 200 },
  );

  expect(replacement.budgets.rent).toBe(200);
  expect(replacement.subcategoryBudgets.rent).toEqual({ "rent-sub": 40, "rent-other": 10 });
  expect(replacement.overCategoryIds).toEqual([]);
  expect(replacement.amountRows).toEqual([{ id: "rent", amount: 200 }]);
});

test("a category ceiling below the breakdown leaves the saved budget unchanged", () => {
  const current = {
    budgets: { rent: 100 },
    subcategoryBudgets: { rent: { "rent-sub": 100 } },
  };
  const replacement = replaceBudgetAllocations(current, { rent: { "rent-sub": 80 } }, { rent: 50 });

  expect(replacement.overCategoryIds).toEqual(["rent"]);
  expect(replacement.budgets).toEqual(current.budgets);
  expect(replacement.subcategoryBudgets).toEqual(current.subcategoryBudgets);
  expect(replacement.amountRows).toEqual([{ id: "rent", amount: 50 }]);
});

test("a zero ceiling with an empty breakdown clears the category", () => {
  const replacement = replaceBudgetAllocations(
    { budgets: { food: 60 }, subcategoryBudgets: { food: { "food-sub": 60 } } },
    { food: { "food-sub": 0 } },
    { food: 0 },
  );

  expect(replacement.budgets).toEqual({});
  expect(replacement.subcategoryBudgets).toEqual({});
  expect(replacement.overCategoryIds).toEqual([]);
});

test("a subcategory write cannot exceed its category budget", () => {
  const current = {
    budgets: { rent: 100 },
    subcategoryBudgets: { rent: { "rent-sub": 40 } },
  };
  const refused = setSubcategoryBudget(
    current.budgets,
    current.subcategoryBudgets,
    "rent",
    "rent-other",
    70,
  );

  expect(refused.error).toContain("category budget");
  expect(refused.budgets).toBe(current.budgets);
  expect(refused.subcategoryBudgets).toBe(current.subcategoryBudgets);

  const raised = setSubcategoryBudget({}, {}, "rent", "rent-sub", 25);

  expect(raised.error).toBeUndefined();
  expect(raised.budgets).toEqual({ rent: 25 });
  expect(raised.subcategoryBudgets).toEqual({ rent: { "rent-sub": 25 } });

  const cleared = setSubcategoryBudget(
    raised.budgets,
    raised.subcategoryBudgets,
    "rent",
    "rent-sub",
    0,
  );

  expect(cleared.budgets).toEqual({ rent: 25 });
  expect(cleared.subcategoryBudgets).toEqual({});
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
