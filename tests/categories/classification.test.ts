import { describe, expect, test } from "bun:test";
import { resolveImportSub } from "@/frontend/auth/lib/category-import";
import { buildExpenseCsv } from "@/frontend/auth/lib/export";
import { buildCategoryIndex, isIncomeCategory } from "@/frontend/lib/categories";
import { assessSpendingHabit, habitPeriodExpenses } from "@/frontend/lib/spendingHabits";
import { classifyTx, isSavings, isSpend } from "@/frontend/lib/stats";
import type { Category, Expense } from "@/frontend/lib/types";
import { validateTaxonomy } from "@/schemas/category";

/**
 * Taxonomy with a user-created category of every type alongside the builtins,
 * so classification is exercised on categories the static SUB_BY_ID fallback
 * has never heard of.
 */
const CATEGORIES: Category[] = [
  {
    id: "food",
    name: "Food & Dining",
    color: "#5b7a8a",
    glyph: "🍽️",
    type: "expense",
    builtin: true,
    subs: [{ id: "food_groceries", name: "Groceries" }],
  },
  {
    id: "cat_hobbies",
    name: "Hobbies",
    color: "#7a6fa5",
    glyph: "🎨",
    type: "expense",
    builtin: false,
    subs: [{ id: "sub_paint", name: "Painting" }],
  },
  {
    id: "cat_emergency",
    name: "Emergency Fund",
    color: "#4f8a7b",
    glyph: "🛟",
    type: "savings",
    builtin: false,
    subs: [{ id: "sub_rainy_day", name: "Rainy Day" }],
  },
  {
    id: "cat_side_hustle",
    name: "Side Hustle",
    color: "#6f8b6f",
    glyph: "💻",
    type: "income",
    builtin: false,
    subs: [
      { id: "sub_consulting", name: "Consulting" },
      { id: "sub_royalties", name: "Royalties" },
    ],
  },
  {
    id: "income",
    name: "Income",
    color: "#6f8b6f",
    glyph: "💵",
    type: "income",
    builtin: true,
    subs: [{ id: "salary", name: "Salary" }],
  },
];

const INDEX = buildCategoryIndex(CATEGORIES);

function tx(
  date: string,
  amount: number,
  sub: string,
  kind: "expense" | "income" = "expense",
  id = `${date}-${sub}-${amount}`,
): Expense {
  return { id, walletId: "w1", kind, date, sub, amount, note: "", recurring: false };
}

describe("classifyTx", () => {
  test("classifies user-created categories of every type", () => {
    expect(classifyTx(tx("2026-07-01", 10, "sub_paint"), INDEX)).toBe("spend");
    expect(classifyTx(tx("2026-07-01", 10, "sub_rainy_day"), INDEX)).toBe("savings");
    expect(classifyTx(tx("2026-07-01", 10, "sub_consulting", "income"), INDEX)).toBe("income");
  });

  test("isSavings and isSpend agree with classifyTx", () => {
    const saving = tx("2026-07-01", 10, "sub_rainy_day");
    const spending = tx("2026-07-01", 10, "sub_paint");

    expect(isSavings(saving, INDEX)).toBe(true);
    expect(isSpend(saving, INDEX)).toBe(false);
    expect(isSpend(spending, INDEX)).toBe(true);
    expect(isSavings(spending, INDEX)).toBe(false);
  });

  test("an orphaned subcategory falls back to kind", () => {
    expect(classifyTx(tx("2026-07-01", 10, "sub_deleted"), INDEX)).toBe("spend");
    expect(classifyTx(tx("2026-07-01", 10, "sub_deleted", "income"), INDEX)).toBe("income");
  });

  test("an archived savings category still classifies as savings", () => {
    const archived = buildCategoryIndex(
      CATEGORIES.map((c) => (c.id === "cat_emergency" ? { ...c, archived: true } : c)),
    );

    expect(classifyTx(tx("2026-07-01", 10, "sub_rainy_day"), archived)).toBe("savings");
  });

  test("an income-kind row against a savings sub is a withdrawal, not income", () => {
    expect(classifyTx(tx("2026-07-01", 10, "sub_rainy_day", "income"), INDEX)).toBe("withdrawal");
  });

  test("an income-kind row against a non-savings sub is still plain income", () => {
    expect(classifyTx(tx("2026-07-01", 10, "sub_consulting", "income"), INDEX)).toBe("income");
  });

  test("an orphaned sub on an income-kind row falls back to income, not withdrawal", () => {
    expect(classifyTx(tx("2026-07-01", 10, "sub_deleted", "income"), INDEX)).toBe("income");
  });
});

describe("buildCategoryIndex archiving", () => {
  const archived = buildCategoryIndex(
    CATEGORIES.map((c) => (c.id === "cat_emergency" ? { ...c, archived: true } : c)),
  );

  test("keeps archived entries resolvable but out of every partition", () => {
    expect(archived.catById.cat_emergency).toBeDefined();
    expect(archived.subById.sub_rainy_day).toBeDefined();

    expect(archived.categories.map((c) => c.id)).not.toContain("cat_emergency");
    expect(archived.savingsCategories.map((c) => c.id)).not.toContain("cat_emergency");
    expect(archived.expenseCategories.map((c) => c.id)).not.toContain("cat_emergency");
    expect(archived.archivedCategories.map((c) => c.id)).toEqual(["cat_emergency"]);
  });

  test("allCategories keeps the full taxonomy for round-tripping", () => {
    expect(archived.allCategories).toHaveLength(CATEGORIES.length);
    expect(archived.allCategories.map((c) => c.id)).toContain("cat_emergency");
  });

  test("archived subs stay resolvable but are dropped from live partitions", () => {
    const withArchivedSub = buildCategoryIndex(
      CATEGORIES.map((c) =>
        c.id === "cat_hobbies" ? { ...c, subs: c.subs.map((s) => ({ ...s, archived: true })) } : c,
      ),
    );

    expect(withArchivedSub.subById.sub_paint).toBeDefined();
    expect(withArchivedSub.catById.cat_hobbies).toBeDefined();
    expect(withArchivedSub.categories.find((c) => c.id === "cat_hobbies")).toBeUndefined();
    expect(classifyTx(tx("2026-07-01", 10, "sub_paint"), withArchivedSub)).toBe("spend");
  });
});

describe("validateTaxonomy with archived categories", () => {
  test("archived categories cannot satisfy the required types", () => {
    const noLiveIncome = CATEGORIES.map((c) =>
      c.type === "income" ? { ...c, archived: true } : c,
    );

    expect(validateTaxonomy(noLiveIncome)).toBe("At least one income category is required");
  });

  test("a live category of each type passes", () => {
    expect(validateTaxonomy(CATEGORIES)).toBeNull();
  });

  test("archived subs keep unique ids and still satisfy min-1", () => {
    const withArchivedSub = CATEGORIES.map((c) =>
      c.id === "cat_side_hustle"
        ? {
            ...c,
            subs: c.subs.map((s) => (s.id === "sub_royalties" ? { ...s, archived: true } : s)),
          }
        : c,
    );

    expect(validateTaxonomy(withArchivedSub)).toBeNull();
  });
});

describe("habit engine honors custom categories", () => {
  /* Five active days so the habit gate unlocks. */
  const spending = [
    tx("2026-07-01", 20, "sub_paint"),
    tx("2026-07-03", 25, "sub_paint"),
    tx("2026-07-05", 15, "food_groceries"),
    tx("2026-07-07", 30, "sub_paint"),
    tx("2026-07-09", 10, "food_groceries"),
  ];
  const savings = [tx("2026-07-02", 500, "sub_rainy_day"), tx("2026-07-08", 500, "sub_rainy_day")];
  const income = [tx("2026-07-04", 4000, "sub_consulting", "income")];

  test("excludes custom savings and income, includes custom expense", () => {
    const list = habitPeriodExpenses(
      [...spending, ...savings, ...income],
      "month",
      "2026-07",
      INDEX,
    );

    expect(list).toHaveLength(spending.length);
    expect(list.map((e) => e.sub)).not.toContain("sub_rainy_day");
    expect(list.map((e) => e.sub)).not.toContain("sub_consulting");
  });

  test("the custom savings category does not inflate the assessed transactions", () => {
    const withSavings = assessSpendingHabit(
      [...spending, ...savings, ...income],
      "month",
      "2026-07",
      INDEX,
    );
    const withoutSavings = assessSpendingHabit(spending, "month", "2026-07", INDEX);

    expect(withSavings.status).toBe("ready");
    expect(withoutSavings.status).toBe("ready");
    if (withSavings.status === "ready" && withoutSavings.status === "ready") {
      expect(withSavings.metrics.txCount).toBe(withoutSavings.metrics.txCount);
      expect(withSavings.metrics.txCount).toBe(spending.length);
    }
  });

  test("archiving the savings category keeps it out of spend", () => {
    const archived = buildCategoryIndex(
      CATEGORIES.map((c) => (c.id === "cat_emergency" ? { ...c, archived: true } : c)),
    );
    const list = habitPeriodExpenses([...spending, ...savings], "month", "2026-07", archived);

    expect(list).toHaveLength(spending.length);
  });
});

describe("CSV category type round-trip", () => {
  const expenses = [
    tx("2026-07-01", 20, "sub_paint"),
    tx("2026-07-02", 500, "sub_rainy_day"),
    tx("2026-07-04", 4000, "sub_consulting", "income"),
  ];

  test("export emits a CategoryType column", () => {
    const csv = buildExpenseCsv(expenses, [], INDEX);
    const [header, ...rows] = csv.trim().split("\n");

    expect(header).toContain("CategoryType");

    const typeIdx = header!.split(",").indexOf("CategoryType");
    const types = rows.map((r) => r.split(",")[typeIdx]);
    expect(types).toContain("savings");
    expect(types).toContain("income");
    expect(types).toContain("expense");
  });

  test("import creates a savings category when the type says so", () => {
    const result = resolveImportSub(CATEGORIES, {
      kind: "expense",
      catName: "Holiday Fund",
      catId: "",
      catType: "savings",
      subName: "Japan Trip",
      subId: "",
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const created = result.categories.find((c) => c.name === "Holiday Fund");
    expect(created?.type).toBe("savings");

    const index = buildCategoryIndex(result.categories);
    expect(classifyTx(tx("2026-07-01", 50, result.subId), index)).toBe("savings");
  });

  test("a savings category is valid for an expense-kind row", () => {
    const result = resolveImportSub(CATEGORIES, {
      kind: "expense",
      catName: "Buffer",
      catId: "",
      catType: "savings",
      subName: "Buffer",
      subId: "",
    });

    expect("error" in result).toBe(false);
  });

  test("an income type on an expense row is rejected", () => {
    const result = resolveImportSub(CATEGORIES, {
      kind: "expense",
      catName: "Bonus",
      catId: "",
      catType: "income",
      subName: "Bonus",
      subId: "",
    });

    expect("error" in result).toBe(true);
  });

  test("a missing type column still imports as expense", () => {
    const result = resolveImportSub(CATEGORIES, {
      kind: "expense",
      catName: "Parking",
      catId: "",
      subName: "Parking",
      subId: "",
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.categories.find((c) => c.name === "Parking")?.type).toBe("expense");
  });

  test("name matching never attaches rows to an archived category", () => {
    const withArchived = CATEGORIES.map((c) =>
      c.id === "cat_hobbies" ? { ...c, archived: true } : c,
    );
    const result = resolveImportSub(withArchived, {
      kind: "expense",
      catName: "Hobbies",
      catId: "",
      catType: "expense",
      subName: "Sketching",
      subId: "",
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    /* A fresh live "Hobbies" is created rather than reviving the retired one. */
    const live = result.categories.filter((c) => c.name === "Hobbies" && !c.archived);
    expect(live).toHaveLength(1);
    expect(live[0]!.id).not.toBe("cat_hobbies");
  });

  test("name matching never attaches rows to an archived subcategory", () => {
    const withArchivedSub = CATEGORIES.map((c) =>
      c.id === "cat_hobbies" ? { ...c, subs: c.subs.map((s) => ({ ...s, archived: true })) } : c,
    );
    const result = resolveImportSub(withArchivedSub, {
      kind: "expense",
      catName: "Hobbies",
      catId: "",
      catType: "expense",
      subName: "Painting",
      subId: "",
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.subId).not.toBe("sub_paint");
    expect(result.newSubcategory).toBe(true);
  });
});

describe("withdrawal CSV round-trip", () => {
  test("a withdrawal exports as Type=income, CategoryType=savings", () => {
    const withdrawal = tx("2026-07-05", 200, "sub_rainy_day", "income");
    const csv = buildExpenseCsv([withdrawal], [], INDEX);
    const [header, row] = csv.trim().split("\n");
    const cols = header!.split(",");
    const values = row!.split(",");

    expect(values[cols.indexOf("Type")]).toBe("income");
    expect(values[cols.indexOf("CategoryType")]).toBe("savings");
  });

  test("re-importing a withdrawal row (income kind, savings type) resolves to the existing savings sub", () => {
    const result = resolveImportSub(CATEGORIES, {
      kind: "income",
      catName: "Emergency Fund",
      catId: "cat_emergency",
      catType: "savings",
      subName: "Rainy Day",
      subId: "sub_rainy_day",
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.subId).toBe("sub_rainy_day");
    expect(result.newCategory).toBe(false);
    expect(result.newSubcategory).toBe(false);
  });

  test("a new withdrawal-only savings category can still be created from an income-kind row", () => {
    const result = resolveImportSub(CATEGORIES, {
      kind: "income",
      catName: "New Envelope",
      catId: "",
      catType: "savings",
      subName: "Starter",
      subId: "",
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const created = result.categories.find((c) => c.name === "New Envelope");
    expect(created?.type).toBe("savings");
  });

  test("a plain income-kind row (no savings declaration) still routes to the income category", () => {
    const result = resolveImportSub(CATEGORIES, {
      kind: "income",
      catName: "",
      catId: "",
      subName: "Freelance",
      subId: "",
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const index = buildCategoryIndex(result.categories);
    const catId = index.subById[result.subId]?.catId;
    expect(catId ? isIncomeCategory(index.catById[catId]!) : false).toBe(true);
  });
});
