import { describe, expect, test } from "bun:test";
import { buildCategoryIndex } from "@/frontend/lib/categories";
import {
  INCOME_MIN_EVENTS,
  INCOME_MIN_MONTHS,
  assessIncomeProfile,
  computeIncomeMetrics,
  incomeBlend,
  pickIncomeStyle,
  rankIncomeStyles,
} from "@/frontend/lib/incomeProfile";
import type { Category, Expense } from "@/frontend/lib/types";

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
    id: "savings",
    name: "Savings",
    color: "#4f8a7b",
    glyph: "🏦",
    type: "savings",
    builtin: true,
    subs: [{ id: "sav_general", name: "General" }],
  },
  {
    id: "income",
    name: "Income",
    color: "#6f8b6f",
    glyph: "💵",
    type: "income",
    builtin: true,
    subs: [
      { id: "salary", name: "Salary" },
      { id: "bonus", name: "Bonus" },
      { id: "wages", name: "Wages" },
      { id: "funds", name: "Funds" },
    ],
  },
];

const INDEX = buildCategoryIndex(CATEGORIES);

/** Anchor month for every fixture — windows run backwards from here. */
const ANCHOR = "2026-07";

function inc(
  date: string,
  amount: number,
  sub = "salary",
  id = `${date}-${sub}-${amount}`,
): Expense {
  return { id, walletId: "w1", kind: "income", date, sub, amount, note: "", recurring: false };
}

function spend(date: string, amount: number, id = `s-${date}-${amount}`): Expense {
  return {
    id,
    walletId: "w1",
    kind: "expense",
    date,
    sub: "food_groceries",
    amount,
    note: "",
    recurring: false,
  };
}

/** Monthly salary on the same day, across the trailing `n` months of the window. */
function monthlySalary(amount: (i: number) => number, n = 6, day = "25", sub = "salary") {
  const out: Expense[] = [];
  for (let i = 0; i < n; i++) {
    const month = 7 - i;
    const key = `2026-${String(month).padStart(2, "0")}`;
    out.push(inc(`${key}-${day}`, amount(i), sub, `${key}-${sub}`));
  }
  return out;
}

describe("gate", () => {
  test("stays locked below the payment minimum", () => {
    const result = assessIncomeProfile(
      [inc("2026-06-25", 3000), inc("2026-07-25", 3000)],
      ANCHOR,
      "6mo",
      INDEX,
    );

    expect(result.status).toBe("insufficient");
    if (result.status === "insufficient") {
      expect(result.txHave).toBe(2);
      expect(result.txNeeded).toBe(INCOME_MIN_EVENTS);
    }
  });

  test("stays locked when every payment lands in one month", () => {
    const result = assessIncomeProfile(
      [
        inc("2026-07-01", 900, "wages", "a"),
        inc("2026-07-10", 900, "wages", "b"),
        inc("2026-07-20", 900, "wages", "c"),
      ],
      ANCHOR,
      "6mo",
      INDEX,
    );

    expect(result.status).toBe("insufficient");
    if (result.status === "insufficient") {
      expect(result.monthsHave).toBe(1);
      expect(result.monthsNeeded).toBe(INCOME_MIN_MONTHS);
    }
  });

  test("unlocks with enough payments across enough months", () => {
    const result = assessIncomeProfile(
      [inc("2026-05-25", 3000), inc("2026-06-25", 3000), inc("2026-07-25", 3000)],
      ANCHOR,
      "6mo",
      INDEX,
    );

    expect(result.status).toBe("ready");
  });

  test("savings and spend never count toward the gate", () => {
    const rows = [
      inc("2026-06-25", 3000),
      inc("2026-07-25", 3000),
      spend("2026-05-02", 40),
      { ...spend("2026-05-03", 500, "sv"), sub: "sav_general" },
    ];

    expect(assessIncomeProfile(rows, ANCHOR, "6mo", INDEX).status).toBe("insufficient");
  });
});

describe("withdrawals", () => {
  /** An income-kind transaction against a savings sub — money taken back out. */
  function withdraw(date: string, amount: number, id = `wd-${date}-${amount}`): Expense {
    return {
      id,
      walletId: "w1",
      kind: "income",
      date,
      sub: "sav_general",
      amount,
      note: "",
      recurring: false,
    };
  }

  test("a withdrawal never counts toward the income gate", () => {
    const rows = [inc("2026-06-25", 3000), withdraw("2026-07-25", 3000)];

    expect(assessIncomeProfile(rows, ANCHOR, "6mo", INDEX).status).toBe("insufficient");
  });

  test("a withdrawal is excluded from the payments, sources and monthly income", () => {
    const salary = monthlySalary(() => 4200);
    const withWithdrawal = computeIncomeMetrics(
      [...salary, withdraw("2026-07-10", 900)],
      ANCHOR,
      "6mo",
      INDEX,
    ).metrics;
    const without = computeIncomeMetrics(salary, ANCHOR, "6mo", INDEX).metrics;

    expect(withWithdrawal.txCount).toBe(without.txCount);
    expect(withWithdrawal.monthlyMean).toBe(without.monthlyMean);
    expect(withWithdrawal.sourceCount).toBe(without.sourceCount);
    expect(withWithdrawal.topSourceShare).toBe(without.topSourceShare);
  });
});

describe("archetypes", () => {
  test("identical monthly salary reads as salaried", () => {
    const scores = computeIncomeMetrics(
      monthlySalary(() => 4200),
      ANCHOR,
      "6mo",
      INDEX,
    ).scores;

    expect(pickIncomeStyle(scores)).toBe("salaried");
  });

  test("regular cadence with swinging amounts reads as variable", () => {
    const swings = [3200, 5400, 2600, 6100, 2900, 5200];
    const scores = computeIncomeMetrics(
      monthlySalary((i) => swings[i]!, 6, "25", "wages"),
      ANCHOR,
      "6mo",
      INDEX,
    ).scores;

    expect(pickIncomeStyle(scores)).toBe("variable");
  });

  test("irregular gaps with dry months reads as project-based", () => {
    const rows = [
      inc("2026-02-11", 5200, "wages", "p1"),
      inc("2026-03-04", 900, "wages", "p2"),
      inc("2026-05-27", 7400, "wages", "p3"),
      inc("2026-07-19", 1800, "wages", "p4"),
    ];
    const scores = computeIncomeMetrics(rows, ANCHOR, "6mo", INDEX).scores;

    expect(pickIncomeStyle(scores)).toBe("projectBased");
  });

  test("four balanced sources read as portfolio", () => {
    const subs = ["salary", "bonus", "wages", "funds"];
    const rows: Expense[] = [];
    for (let i = 0; i < 6; i++) {
      const key = `2026-${String(7 - i).padStart(2, "0")}`;
      subs.forEach((sub, s) => rows.push(inc(`${key}-1${s}`, 1000, sub, `${key}-${sub}`)));
    }
    const scores = computeIncomeMetrics(rows, ANCHOR, "6mo", INDEX).scores;

    expect(pickIncomeStyle(scores)).toBe("portfolio");
  });

  test("one outsized payment reads as windfall", () => {
    const rows = [
      inc("2026-03-05", 400, "wages", "w1"),
      inc("2026-04-05", 500, "wages", "w2"),
      inc("2026-05-20", 42000, "bonus", "w3"),
      inc("2026-06-05", 450, "wages", "w4"),
      inc("2026-07-05", 380, "wages", "w5"),
    ];
    const scores = computeIncomeMetrics(rows, ANCHOR, "6mo", INDEX).scores;

    expect(pickIncomeStyle(scores)).toBe("windfall");
  });

  test("sparse income reads as emerging", () => {
    const rows = [
      inc("2026-06-14", 120, "wages", "e1"),
      inc("2026-07-02", 90, "funds", "e2"),
      inc("2026-07-21", 140, "bonus", "e3"),
    ];
    const scores = computeIncomeMetrics(rows, ANCHOR, "6mo", INDEX).scores;

    expect(pickIncomeStyle(scores)).toBe("emerging");
  });
});

describe("source grain", () => {
  test("sources key on subcategory, not parent category", () => {
    const rows = [
      inc("2026-05-25", 4000, "salary", "s1"),
      inc("2026-06-25", 4000, "salary", "s2"),
      inc("2026-06-28", 1200, "bonus", "s3"),
      inc("2026-07-25", 4000, "salary", "s4"),
    ];
    const { metrics } = computeIncomeMetrics(rows, ANCHOR, "6mo", INDEX);

    // Two subcategories under one Income parent: keyed by parent this would be 1.
    expect(metrics.sourceCount).toBe(2);
    expect(metrics.topSourceShare).toBeCloseTo(12000 / 13200, 6);
  });

  test("concentration and top share follow the sources", () => {
    const { metrics } = computeIncomeMetrics(
      monthlySalary(() => 4200),
      ANCHOR,
      "6mo",
      INDEX,
    );

    expect(metrics.topSourceShare).toBe(1);
    expect(metrics.hhi).toBe(1);
    expect(metrics.sourceCount).toBe(1);
  });
});

describe("window", () => {
  test("6mo and 12mo cover different spans of the same ledger", () => {
    const rows = monthlySalary(() => 3000, 12);
    const six = computeIncomeMetrics(rows, ANCHOR, "6mo", INDEX).metrics;
    const twelve = computeIncomeMetrics(rows, ANCHOR, "12mo", INDEX).metrics;

    expect(six.monthsInWindow).toBe(6);
    expect(twelve.monthsInWindow).toBe(12);
    expect(twelve.txCount).toBeGreaterThan(six.txCount);
    expect(twelve.monthsWithIncome).toBeGreaterThan(six.monthsWithIncome);
  });

  test("transactions outside the window are excluded", () => {
    const rows = [...monthlySalary(() => 3000), inc("2024-01-25", 99999, "bonus", "ancient")];
    const { metrics } = computeIncomeMetrics(rows, ANCHOR, "6mo", INDEX);

    expect(metrics.txCount).toBe(6);
    expect(metrics.monthlyMean).toBe(3000);
    expect(metrics.sourceCount).toBe(1);
  });
});

describe("confidence and blend", () => {
  test("a thin window is low confidence, a full one is higher", () => {
    const thin = assessIncomeProfile(
      [
        inc("2026-06-25", 900, "wages", "t1"),
        inc("2026-07-02", 800, "wages", "t2"),
        inc("2026-07-20", 850, "wages", "t3"),
      ],
      ANCHOR,
      "6mo",
      INDEX,
    );
    const full = assessIncomeProfile(
      monthlySalary(() => 4200, 12),
      ANCHOR,
      "12mo",
      INDEX,
    );

    expect(thin.status).toBe("ready");
    expect(full.status).toBe("ready");
    if (thin.status === "ready" && full.status === "ready") {
      expect(thin.confidence.level).toBe("low");
      expect(full.confidence.value).toBeGreaterThan(thin.confidence.value);
      expect(full.confidence.reasons.length).toBeGreaterThan(0);
    }
  });

  test("a dominant archetype has no secondary", () => {
    const scores = computeIncomeMetrics(
      monthlySalary(() => 4200),
      ANCHOR,
      "6mo",
      INDEX,
    ).scores;
    const blend = incomeBlend(rankIncomeStyles(scores));

    if (blend.secondary) expect(blend.label).toContain(blend.secondary.trait);
    expect(blend.label).toContain("The");
  });

  test("blend label names the secondary trait when one qualifies", () => {
    const ranked = rankIncomeStyles({
      salaried: 0.7,
      variable: 0.6,
      projectBased: 0.1,
      portfolio: 0.1,
      windfall: 0,
      emerging: 0,
    });
    const blend = incomeBlend(ranked);

    expect(blend.secondary?.id).toBe("variable");
    expect(blend.label).toBe("The Salaried Anchor, with a Variable streak");
    expect(blend.weight).toBeCloseTo(0.6 / 1.3, 6);
  });
});
