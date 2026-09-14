import { describe, expect, test } from "bun:test";
import { buildCategoryIndex } from "@/frontend/lib/categories";
import { dayFlowSeries, spendingChartSeries } from "@/frontend/lib/stats";
import type { Category, Expense } from "@/frontend/lib/types";

const CATEGORIES: Category[] = [
  {
    id: "food",
    name: "Food",
    color: "#a15c4a",
    glyph: "🍽️",
    type: "expense",
    subs: [
      { id: "food-groceries", name: "Groceries" },
      { id: "food-dining", name: "Dining" },
    ],
  },
  {
    id: "transport",
    name: "Transport",
    color: "#4a6fa5",
    glyph: "🚗",
    type: "expense",
    subs: [{ id: "transport-fuel", name: "Fuel" }],
  },
  {
    id: "savings",
    name: "Savings",
    color: "#5f8a7a",
    glyph: "🐷",
    type: "savings",
    subs: [{ id: "savings-emergency", name: "Emergency Fund" }],
  },
  {
    id: "income",
    name: "Income",
    color: "#6f8b6f",
    glyph: "💵",
    type: "income",
    subs: [
      { id: "income-salary", name: "Salary" },
      { id: "income-side", name: "Side Gig" },
    ],
  },
];

const INDEX = buildCategoryIndex(CATEGORIES);

/** Build a minimal transaction; `kind` defaults to expense. */
function tx(
  date: string,
  amount: number,
  sub: string,
  kind: Expense["kind"] = "expense",
  id = `${date}-${sub}-${amount}`,
): Expense {
  return { id, walletId: "w1", kind, date, sub, amount, note: "", recurring: false };
}

describe("dayFlowSeries", () => {
  test("folds a day's subcategories into their parent category on both sides", () => {
    const series = dayFlowSeries(
      [
        tx("2026-08-03", 20, "food-groceries"),
        tx("2026-08-03", 12.5, "food-groceries", "expense", "second-grocery-run"),
        tx("2026-08-03", 5, "food-dining"),
        tx("2026-08-03", 40, "transport-fuel"),
        tx("2026-08-03", 900, "income-salary", "income"),
        tx("2026-08-03", 75, "income-side", "income"),
      ],
      "2026-08",
      INDEX,
      3,
    );

    const day = series[2]!;
    expect(day.day).toBe("2026-08-03");
    expect(day.label).toBe("3");
    expect(day.spent).toBe(77.5);
    expect(day.earned).toBe(975);

    // Largest first: Transport 40, then Food 37.5 (two grocery runs + one dining).
    expect(day.spend.map((s) => s.id)).toEqual(["transport", "food"]);
    expect(day.spend[0]).toMatchObject({ name: "Transport", amount: 40, count: 1, glyph: "🚗" });
    expect(day.spend[1]).toMatchObject({ name: "Food", amount: 37.5, count: 3, glyph: "🍽️" });
    // Salary and Side Gig share one Income category, so they read as a single row.
    expect(day.earn.map((e) => [e.id, e.name, e.amount, e.count])).toEqual([
      ["income", "Income", 975, 2],
    ]);
  });

  test("counts a savings deposit as spend, matching the trend line and totalBudget", () => {
    const series = dayFlowSeries(
      [tx("2026-08-01", 30, "food-groceries"), tx("2026-08-01", 200, "savings-emergency")],
      "2026-08",
      INDEX,
      1,
    );

    expect(series[0]!.spent).toBe(230);
    // Largest first: the 200 deposit outweighs the 30 grocery run.
    expect(series[0]!.spend.map((s) => s.id)).toEqual(["savings", "food"]);
  });

  test("nets a savings withdrawal against spend without adding a category row", () => {
    const series = dayFlowSeries(
      [tx("2026-08-01", 30, "food-groceries"), tx("2026-08-01", 50, "savings-emergency", "income")],
      "2026-08",
      INDEX,
      1,
    );

    expect(series[0]!.spent).toBe(-20);
    expect(series[0]!.spend.map((s) => s.id)).toEqual(["food"]);
  });

  test("emits an empty entry for every day up to the cap", () => {
    const series = dayFlowSeries([tx("2026-08-04", 10, "food-dining")], "2026-08", INDEX, 5);

    expect(series).toHaveLength(5);
    expect(series[0]).toMatchObject({
      day: "2026-08-01",
      spent: 0,
      earned: 0,
      spend: [],
      earn: [],
    });
    expect(series[3]!.spent).toBe(10);
  });

  test("covers the whole month when no cap is given and ignores other months", () => {
    const series = dayFlowSeries(
      [tx("2026-02-28", 10, "food-dining"), tx("2026-03-01", 99, "food-dining")],
      "2026-02",
      INDEX,
    );

    expect(series).toHaveLength(28);
    expect(series.at(-1)!.spent).toBe(10);
    expect(series.reduce((s, d) => s + d.spent, 0)).toBe(10);
  });

  test("clamps a cap past the end of the month", () => {
    expect(dayFlowSeries([], "2026-02", INDEX, 40)).toHaveLength(28);
  });
});

describe("spendingChartSeries income", () => {
  const expenses = [
    tx("2026-07-10", 100, "food-groceries"),
    tx("2026-07-10", 500, "income-salary", "income"),
    tx("2026-08-02", 60, "transport-fuel"),
    tx("2026-08-02", 300, "savings-emergency"),
    tx("2026-08-05", 800, "income-salary", "income"),
  ];

  test("reports spend and income per monthly bar", () => {
    const bars = spendingChartSeries("monthly", expenses, "2026-08", INDEX);
    const august = bars.find((b) => b.key === "2026-08")!;
    const july = bars.find((b) => b.key === "2026-07")!;

    expect(july).toMatchObject({ spent: 100, earned: 500 });
    // Savings deposits now count toward spend, matching the trend line; income is unaffected.
    expect(august).toMatchObject({ spent: 360, earned: 800 });
  });

  test("carries income through daily, quarterly, and yearly buckets", () => {
    const daily = spendingChartSeries("daily", expenses, "2026-08", INDEX);
    expect(daily.find((b) => b.key === "2026-08-05")).toMatchObject({ spent: 0, earned: 800 });

    const quarterly = spendingChartSeries("quarterly", expenses, "2026-08", INDEX);
    expect(quarterly.at(-1)).toMatchObject({ key: "2026-Q3", spent: 460, earned: 1300 });

    const yearly = spendingChartSeries("yearly", expenses, "2026-08", INDEX);
    expect(yearly.at(-1)).toMatchObject({ key: "2026", spent: 460, earned: 1300 });
  });
});
