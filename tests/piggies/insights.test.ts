import { describe, expect, test } from "bun:test";
import { planMonthlySave } from "@/frontend/lib/capitals";
import { buildCategoryIndex } from "@/frontend/lib/categories";
import { roundMoney } from "@/frontend/lib/data";
import { buildPiggies } from "@/frontend/lib/piggies";
import { computeSavingsInsights } from "@/frontend/lib/savingsInsights";
import type { CapitalPlan, Category, Expense } from "@/frontend/lib/types";

const CATEGORIES: Category[] = [
  {
    id: "income",
    name: "Income",
    color: "#6f8b6f",
    glyph: "💵",
    type: "income",
    subs: [{ id: "salary", name: "Salary" }],
  },
  {
    id: "cat_emergency",
    name: "Emergency Fund",
    color: "#7a6fa5",
    glyph: "🛟",
    type: "savings",
    target: 1000,
    deadline: "2026-12-01",
    subs: [{ id: "sub_rainy_day", name: "Rainy Day" }],
  },
  {
    id: "cat_goalless",
    name: "No Goal",
    color: "#a06f95",
    glyph: "🐖",
    type: "savings",
    subs: [{ id: "sub_goalless", name: "Whatever" }],
  },
];

const INDEX = buildCategoryIndex(CATEGORIES);
const ANCHOR = "2026-07";

function tx(
  date: string,
  amount: number,
  sub: string,
  kind: "expense" | "income" = "expense",
  id = `${date}-${sub}-${amount}-${kind}`,
): Expense {
  return { id, walletId: "w1", kind, date, sub, amount, note: "", recurring: false };
}

/** A Capitals plan with only the fields a test cares about set. */
function plan_(over: Partial<CapitalPlan> = {}): CapitalPlan {
  return {
    id: "plan_wedding",
    name: "Wedding",
    glyph: "💍",
    createdAt: "2026-01-01",
    items: [],
    ...over,
  };
}

/** Insights over `txns` with `plans` attached, anchored at the shared test month. */
function withPlans(txns: Expense[], plans: CapitalPlan[], windowSize = 12) {
  const piggies = buildPiggies(txns, INDEX);

  return computeSavingsInsights(txns, txns, piggies, INDEX, ANCHOR, windowSize, plans);
}

describe("computeSavingsInsights guards", () => {
  test("zero income yields a 0 savings rate, not NaN or Infinity", () => {
    const txns = [tx("2026-07-01", 200, "sub_rainy_day")];
    const piggies = buildPiggies(txns, INDEX);
    const insights = computeSavingsInsights(txns, txns, piggies, INDEX, ANCHOR);

    expect(insights.savingsRate).toBe(0);
    expect(Number.isFinite(insights.savingsRate)).toBe(true);
  });

  test("no savings history yields zero pace and a null projection, not NaN", () => {
    const piggies = buildPiggies([], INDEX);
    const insights = computeSavingsInsights([], [], piggies, INDEX, ANCHOR);

    const emergency = insights.perPiggy.find((p) => p.catId === "cat_emergency");
    expect(emergency!.monthlyPace).toBe(0);
    expect(emergency!.projectedCompletion).toBeNull();
    expect(Number.isFinite(emergency!.monthlyPace)).toBe(true);
  });

  test("onTrack and requiredMonthly are null when there is no target", () => {
    const piggies = buildPiggies([], INDEX);
    const insights = computeSavingsInsights([], [], piggies, INDEX, ANCHOR);

    const goalless = insights.perPiggy.find((p) => p.catId === "cat_goalless");
    expect(goalless!.onTrack).toBeNull();
    expect(goalless!.requiredMonthly).toBeNull();
  });

  test("onTrack is null when a target exists but no deadline is set", () => {
    const noDeadline = CATEGORIES.map((c) =>
      c.id === "cat_emergency" ? { ...c, deadline: undefined } : c,
    );
    const index = buildCategoryIndex(noDeadline);
    const txns = [tx("2026-06-01", 100, "sub_rainy_day")];
    const piggies = buildPiggies(txns, index);
    const insights = computeSavingsInsights(txns, txns, piggies, index, ANCHOR);

    const emergency = insights.perPiggy.find((p) => p.catId === "cat_emergency");
    expect(emergency!.onTrack).toBeNull();
    expect(emergency!.requiredMonthly).toBeNull();
  });
});

describe("computeSavingsInsights pace and projection", () => {
  test("a steady monthly deposit projects completion and reports on track", () => {
    const txns = [
      tx("2026-05-01", 200, "sub_rainy_day"),
      tx("2026-06-01", 200, "sub_rainy_day"),
      tx("2026-07-01", 200, "sub_rainy_day"),
    ];
    const piggies = buildPiggies(txns, INDEX);
    const insights = computeSavingsInsights(txns, txns, piggies, INDEX, ANCHOR, 6);

    const emergency = insights.perPiggy.find((p) => p.catId === "cat_emergency")!;
    expect(emergency.monthlyPace).toBeGreaterThan(0);
    expect(emergency.projectedCompletion).not.toBeNull();
    // Balance 600, target 1000, deadline 2026-12 — comfortably reachable at this pace.
    expect(emergency.onTrack).toBe(true);
  });

  test("a withdrawal pulls the projection later than deposits alone", () => {
    const deposits = [
      tx("2026-05-01", 200, "sub_rainy_day"),
      tx("2026-06-01", 200, "sub_rainy_day"),
      tx("2026-07-01", 200, "sub_rainy_day"),
    ];
    const withWithdrawal = [...deposits, tx("2026-07-15", 500, "sub_rainy_day", "income")];

    const piggiesA = buildPiggies(deposits, INDEX);
    const piggiesB = buildPiggies(withWithdrawal, INDEX);
    const a = computeSavingsInsights(deposits, deposits, piggiesA, INDEX, ANCHOR, 6).perPiggy.find(
      (p) => p.catId === "cat_emergency",
    )!;
    const b = computeSavingsInsights(
      withWithdrawal,
      withWithdrawal,
      piggiesB,
      INDEX,
      ANCHOR,
      6,
    ).perPiggy.find((p) => p.catId === "cat_emergency")!;

    expect(piggiesB.find((p) => p.catId === "cat_emergency")!.balance).toBeLessThan(
      piggiesA.find((p) => p.catId === "cat_emergency")!.balance,
    );
    // Same or later projected month once the withdrawal has eaten into the balance.
    expect((b.projectedCompletion ?? "9999-99") >= (a.projectedCompletion ?? "9999-99")).toBe(true);
  });

  test("net flow and streak reflect deposits minus withdrawals across the window", () => {
    const txns = [
      tx("2026-05-01", 300, "sub_rainy_day"),
      tx("2026-06-01", 300, "sub_rainy_day"),
      tx("2026-07-01", 100, "sub_rainy_day", "income"),
    ];
    const piggies = buildPiggies(txns, INDEX);
    const insights = computeSavingsInsights(txns, txns, piggies, INDEX, ANCHOR, 3);

    expect(insights.netFlow).toBe(500); // 300 + 300 - 100
    expect(insights.currentStreak).toBe(0); // July net is negative, breaking the streak from the end
  });
});

describe("computeSavingsInsights capital allocation", () => {
  test("capital-assigned deposits count toward net flow, rate, and streak", () => {
    const income = tx("2026-07-01", 5000, "salary", "income");
    const piggyDeposit = tx("2026-07-01", 200, "sub_rainy_day");
    const capitalDeposit = {
      ...tx("2026-07-02", 300, "sub_rainy_day"),
      capitalPlanId: "plan_wedding",
    };
    const txns = [income, piggyDeposit, capitalDeposit];
    const piggies = buildPiggies(txns, INDEX);
    const insights = computeSavingsInsights(txns, txns, piggies, INDEX, ANCHOR, 1);

    expect(insights.netFlow).toBe(500);
    expect(insights.piggyNetFlow).toBe(200);
    expect(insights.capitalNetFlow).toBe(300);
    expect(insights.savingsRate).toBe(0.1); // 500 / 5000
    expect(insights.currentStreak).toBe(1);
  });

  test("a month whose only saving is capital-assigned still counts as a saving month", () => {
    const txns = [
      { ...tx("2026-06-01", 400, "sub_rainy_day"), capitalPlanId: "plan_wedding" },
      { ...tx("2026-07-01", 400, "sub_rainy_day"), capitalPlanId: "plan_wedding" },
    ];
    const piggies = buildPiggies(txns, INDEX);
    const insights = computeSavingsInsights(txns, txns, piggies, INDEX, ANCHOR, 2);

    expect(insights.currentStreak).toBe(2);
    expect(insights.piggyNetFlow).toBe(0);
    expect(insights.capitalNetFlow).toBe(800);
    expect(insights.bestMonth?.amount).toBe(400);
  });

  test("a capital withdrawal pulls the wallet-wide net back down", () => {
    const txns = [
      { ...tx("2026-07-01", 400, "sub_rainy_day"), capitalPlanId: "plan_wedding" },
      { ...tx("2026-07-20", 150, "sub_rainy_day", "income"), capitalPlanId: "plan_wedding" },
    ];
    const piggies = buildPiggies(txns, INDEX);
    const insights = computeSavingsInsights(txns, txns, piggies, INDEX, ANCHOR, 1);

    expect(insights.capitalNetFlow).toBe(250);
    expect(insights.netFlow).toBe(250);
  });

  test("capital-assigned deposits do not inflate monthly pace or recurring pledges", () => {
    const unassigned = [
      tx("2026-05-01", 100, "sub_rainy_day"),
      tx("2026-06-01", 100, "sub_rainy_day"),
      tx("2026-07-01", 100, "sub_rainy_day"),
    ];
    const capitalOnly = [
      ...unassigned,
      { ...tx("2026-07-02", 500, "sub_rainy_day"), capitalPlanId: "plan_wedding" },
    ];
    const capitalRecurring = [
      ...unassigned,
      {
        ...tx("2026-07-02", 600, "sub_rainy_day"),
        capitalPlanId: "plan_wedding",
        recurring: "monthly" as const,
      },
    ];

    const piggies = buildPiggies(capitalOnly, INDEX);
    const insights = computeSavingsInsights(capitalOnly, capitalOnly, piggies, INDEX, ANCHOR, 3);
    const emergency = insights.perPiggy.find((p) => p.catId === "cat_emergency")!;

    expect(emergency.monthlyPace).toBe(100);

    const recurringInsights = computeSavingsInsights(
      capitalRecurring,
      capitalRecurring,
      piggies,
      INDEX,
      ANCHOR,
      3,
    );
    const recurringEmergency = recurringInsights.perPiggy.find((p) => p.catId === "cat_emergency")!;

    expect(recurringEmergency.monthlyPace).toBe(100);
  });
});

describe("computeSavingsInsights capital pace", () => {
  test("a plan with neither a budget nor items has nothing to judge pace against", () => {
    const plan = plan_({ initialBudget: undefined, targetDate: "2026-12-01", items: [] });
    const txns = [{ ...tx("2026-07-01", 300, "sub_rainy_day"), capitalPlanId: plan.id }];
    const insights = withPlans(txns, [plan]);
    const pace = insights.perPlan[0]!;

    expect(pace.onTrack).toBeNull();
    expect(pace.requiredMonthly).toBeNull();
    expect(pace.funded).toBe(false);
    // Nothing to be over, so paid items are not flagged.
    expect(pace.overbudget).toBe(false);
    expect(pace.saved).toBe(300);
    expect(pace.unspent).toBe(300);
  });

  test("a plan with no typed budget is measured against its item estimates", () => {
    const plan = plan_({
      initialBudget: undefined,
      targetDate: "2026-12-01",
      items: [
        { id: "i1", name: "Rings", estimatedCost: 800, paid: true },
        { id: "i2", name: "Suit", estimatedCost: 400, paid: false },
      ],
    });
    const txns = [{ ...tx("2026-07-01", 300, "sub_rainy_day"), capitalPlanId: plan.id }];
    const pace = withPlans(txns, [plan]).perPlan[0]!;

    // Budget 1200 from the estimates, 800 paid — the 300 pot went into that.
    expect(pace.saved).toBe(300);
    expect(pace.unspent).toBe(0);
    expect(pace.remainingNeed).toBe(400);
    expect(pace.overbudget).toBe(false);
    expect(pace.funded).toBe(false);
  });

  test("a plan that paid an item from its own pot is not counted as funded twice", () => {
    const plan = plan_({
      initialBudget: 10000,
      targetDate: "2026-12-01",
      items: [{ id: "i1", name: "Venue", estimatedCost: 4000, paid: true, actualCost: 4000 }],
    });
    const txns = [{ ...tx("2026-07-01", 4000, "sub_rainy_day"), capitalPlanId: plan.id }];
    const pace = withPlans(txns, [plan]).perPlan[0]!;

    expect(pace.saved).toBe(4000);
    expect(pace.unspent).toBe(0);
    // The old (budget − paid − saved) formula answered 2000 here.
    expect(pace.remainingNeed).toBe(6000);
    expect(pace.funded).toBe(false);
  });

  test("steady assigned deposits project a completion month and read as on pace", () => {
    const plan = plan_({ initialBudget: 3000, targetDate: "2027-06-01" });
    const txns = [
      { ...tx("2026-05-01", 500, "sub_rainy_day"), capitalPlanId: plan.id },
      { ...tx("2026-06-01", 500, "sub_rainy_day"), capitalPlanId: plan.id },
      { ...tx("2026-07-01", 500, "sub_rainy_day"), capitalPlanId: plan.id },
    ];
    const pace = withPlans(txns, [plan], 3).perPlan[0]!;

    // 1500 set aside, 1500 to go at 500/mo → three months out, well before the target.
    expect(pace.unspent).toBe(1500);
    expect(pace.remainingNeed).toBe(1500);
    expect(pace.monthlyPace).toBe(500);
    expect(pace.projectedCompletion).toBe("2026-10");
    expect(pace.onTrack).toBe(true);
  });

  test("a plan saving too slowly for its target reads as behind, with the monthly need", () => {
    const plan = plan_({ initialBudget: 6000, targetDate: "2026-09-01" });
    const txns = [
      { ...tx("2026-06-01", 100, "sub_rainy_day"), capitalPlanId: plan.id },
      { ...tx("2026-07-01", 100, "sub_rainy_day"), capitalPlanId: plan.id },
    ];
    const insights = withPlans(txns, [plan], 2);
    const pace = insights.perPlan[0]!;

    expect(pace.onTrack).toBe(false);
    expect(pace.remainingNeed).toBe(5800);
    // Need at the start of July: 5800 to go + the 100 July deposit, over the two months to 2026-09.
    expect(pace.requiredMonthly).toBe(2950);
    expect(insights.headlines.some((h) => h.id === `capital-behind-${plan.id}`)).toBe(true);
  });

  test("requiredMonthly is the Capitals Save/mo for the viewed month", () => {
    const plan = plan_({ initialBudget: 6000, targetDate: "2026-09-01" });
    const txns = [
      { ...tx("2026-06-01", 100, "sub_rainy_day"), capitalPlanId: plan.id },
      { ...tx("2026-07-01", 100, "sub_rainy_day"), capitalPlanId: plan.id },
    ];
    const pace = withPlans(txns, [plan], 2).perPlan[0]!;

    expect(pace.requiredMonthly).toBe(
      roundMoney(planMonthlySave(plan, new Date(2026, 6, 1), txns, INDEX)!),
    );
  });

  test("a deposit in the viewed month does not lower requiredMonthly", () => {
    const plan = plan_({ initialBudget: 3000, targetDate: "2026-09-01" });
    const before = withPlans([], [plan], 2).perPlan[0]!;
    const after = withPlans(
      [{ ...tx("2026-07-10", 500, "sub_rainy_day"), capitalPlanId: plan.id }],
      [plan],
      2,
    ).perPlan[0]!;

    expect(before.requiredMonthly).toBe(1500);
    expect(after.requiredMonthly).toBe(1500);
  });

  test("requiredMonthly covers the target month itself instead of going null", () => {
    const plan = plan_({ initialBudget: 3000, targetDate: "2026-07-20" });
    const pace = withPlans([], [plan], 2).perPlan[0]!;

    expect(pace.requiredMonthly).toBe(3000);
  });

  test("savings on top of a paid item fund the rest of the budget", () => {
    const plan = plan_({
      initialBudget: 1000,
      targetDate: "2026-12-01",
      items: [{ id: "i1", name: "Deposit", estimatedCost: 600, paid: true }],
    });
    // 1000 set aside: 600 of it went on the deposit, 400 is still in the pot,
    // which is exactly the 400 of budget left unpaid.
    const txns = [{ ...tx("2026-07-01", 1000, "sub_rainy_day"), capitalPlanId: plan.id }];
    const insights = withPlans(txns, [plan]);
    const pace = insights.perPlan[0]!;

    expect(pace.unspent).toBe(400);
    expect(pace.remainingNeed).toBe(0);
    expect(pace.funded).toBe(true);
    expect(pace.onTrack).toBe(true);
    expect(insights.headlines.some((h) => h.id === `capital-funded-${plan.id}`)).toBe(true);
  });

  test("an overbudget plan is flagged rather than reported as funded", () => {
    const plan = plan_({
      initialBudget: 500,
      items: [{ id: "i1", name: "Venue", estimatedCost: 900, paid: true }],
    });
    const insights = withPlans([], [plan]);
    const pace = insights.perPlan[0]!;

    expect(pace.overbudget).toBe(true);
    expect(insights.headlines.some((h) => h.id === `capital-overbudget-${plan.id}`)).toBe(true);
    expect(insights.headlines.some((h) => h.id === `capital-funded-${plan.id}`)).toBe(false);
  });

  test("a recurring assigned deposit sets the pace before it has history", () => {
    const plan = plan_({ initialBudget: 2400, targetDate: "2027-01-01" });
    const txns = [
      {
        ...tx("2026-07-01", 400, "sub_rainy_day"),
        capitalPlanId: plan.id,
        recurring: "monthly" as const,
      },
    ];
    const pace = withPlans(txns, [plan], 6).perPlan[0]!;

    // One month of history would average to ~67/mo; the standing order is the real rate.
    expect(pace.monthlyPace).toBe(400);
  });

  test("plans left out means no capital pace — the piggy read is unchanged", () => {
    const txns = [tx("2026-07-01", 200, "sub_rainy_day")];
    const piggies = buildPiggies(txns, INDEX);
    const insights = computeSavingsInsights(txns, txns, piggies, INDEX, ANCHOR, 1);

    expect(insights.perPlan).toEqual([]);
    expect(insights.capitalNetFlow).toBe(0);
    expect(insights.piggyNetFlow).toBe(200);
  });
});
