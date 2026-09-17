import { describe, expect, test } from "bun:test";
import {
  instantiateFromTemplate,
  planBudgetProgress,
  planEffectiveBudget,
  planIsOverbudget,
  planMoney,
  planMonthlySave,
  planMonthsUntilTarget,
  planIsUpcoming,
  planOutOfPocket,
  planOutstandingCost,
  planPaidTotal,
  planProgress,
  planRemainingNeed,
  planSavedTotal,
  releaseOrphanedPlanRefs,
  planTotal,
  planUnpaidTotal,
  planUnspentTotal,
  plansTotalMonthlySave,
} from "@/frontend/lib/capitals";
import { buildCategoryIndex } from "@/frontend/lib/categories";
import type { CapitalPlan, Category, Expense } from "@/frontend/lib/types";

const SAVINGS_CATEGORIES: Category[] = [
  {
    id: "cat_emergency",
    name: "Emergency Fund",
    color: "#7a6fa5",
    glyph: "🛟",
    type: "savings",
    subs: [{ id: "sub_rainy_day", name: "Rainy Day" }],
  },
];

const INDEX = buildCategoryIndex(SAVINGS_CATEGORIES);

function savingsTx(
  date: string,
  amount: number,
  capitalPlanId?: string,
  kind: "expense" | "income" = "expense",
): Expense {
  return {
    id: `${date}-${amount}-${capitalPlanId ?? "piggy"}`,
    walletId: "w1",
    kind,
    date,
    sub: "sub_rainy_day",
    amount,
    note: "",
    recurring: false,
    ...(capitalPlanId ? { capitalPlanId } : {}),
  };
}

function plan(overrides: Partial<CapitalPlan> = {}): CapitalPlan {
  return {
    id: "p1",
    name: "Test Plan",
    glyph: "🎯",
    createdAt: "2026-08-19T00:00:00.000Z",
    items: [
      { id: "i1", name: "Venue", estimatedCost: 5000, paid: true, actualCost: 4800 },
      { id: "i2", name: "Catering", estimatedCost: 3000, paid: false },
      { id: "i3", name: "Rings", estimatedCost: 2000, paid: true },
    ],
    ...overrides,
  };
}

describe("planTotal", () => {
  test("sums every item's estimated cost regardless of paid status", () => {
    expect(planTotal(plan())).toBe(10000);
  });
});

describe("planPaidTotal", () => {
  test("sums actual cost for paid items, falling back to estimate when unset", () => {
    // i1: actualCost 4800, i3: no actualCost so falls back to estimatedCost 2000
    expect(planPaidTotal(plan())).toBe(6800);
  });

  test("returns 0 when nothing is paid", () => {
    const p = plan({ items: [{ id: "i1", name: "Venue", estimatedCost: 5000, paid: false }] });
    expect(planPaidTotal(p)).toBe(0);
  });
});

describe("planUnpaidTotal", () => {
  test("sums estimated cost for unpaid items only", () => {
    expect(planUnpaidTotal(plan())).toBe(3000);
  });

  test("returns 0 when everything is paid", () => {
    const p = plan({
      items: [{ id: "i1", name: "Venue", estimatedCost: 5000, paid: true }],
    });
    expect(planUnpaidTotal(p)).toBe(0);
  });
});

describe("planRemainingNeed", () => {
  test("is budget minus paid", () => {
    // paid 6800, budget 10000 → 3200 left
    expect(planRemainingNeed(plan({ initialBudget: 10000 }))).toBe(3200);
  });

  test("is budget minus paid once payments have emptied the pot", () => {
    // 1000 set aside, 6800 already paid: the pot is spent, so it cannot also
    // reduce the need. Was 2200 under the old (budget − paid − saved) formula.
    const p = plan({ id: "p1", initialBudget: 10000 });
    const txns = [savingsTx("2026-06-01", 1000, "p1")];

    expect(planRemainingNeed(p, txns, INDEX)).toBe(3200);
  });

  test("is budget minus saved while the pot still covers every payment", () => {
    const p = plan({ id: "p1", initialBudget: 10000 });
    const txns = [savingsTx("2026-06-01", 8000, "p1")];

    expect(planRemainingNeed(p, txns, INDEX)).toBe(2000);
  });

  test("subtracts the whole pot while nothing is paid", () => {
    const p = plan({
      id: "p1",
      initialBudget: 10000,
      items: [{ id: "i1", name: "Venue", estimatedCost: 5000, paid: false }],
    });
    const txns = [savingsTx("2026-06-01", 4000, "p1")];

    expect(planRemainingNeed(p, txns, INDEX)).toBe(6000);
  });

  test("counts money set aside and then spent on an item only once", () => {
    // The reported bug: budget 10000, 4000 set aside, that same 4000 spent on
    // a paid item. Old formula answered 2000 by subtracting it twice.
    const p = plan({
      id: "p1",
      initialBudget: 10000,
      items: [{ id: "i1", name: "Venue", estimatedCost: 4000, paid: true, actualCost: 4000 }],
    });
    const txns = [savingsTx("2026-06-01", 4000, "p1")];

    expect(planRemainingNeed(p, txns, INDEX)).toBe(6000);
  });

  test("still counts remaining budget when every item is paid", () => {
    const p = plan({
      initialBudget: 10000,
      items: [
        { id: "i1", name: "Venue", estimatedCost: 5000, paid: true, actualCost: 5000 },
        { id: "i2", name: "Catering", estimatedCost: 3000, paid: true, actualCost: 3000 },
      ],
    });
    expect(planRemainingNeed(p)).toBe(2000);
  });

  test("clamps at 0 when paid meets or exceeds budget", () => {
    expect(planRemainingNeed(plan({ initialBudget: 5000 }))).toBe(0);
  });

  test("planRemainingNeed falls back to the item estimates when no budget is typed", () => {
    // estimates 10000, paid 6800
    expect(planRemainingNeed(plan())).toBe(3200);
  });

  test("planRemainingNeed is 0 with neither a budget nor any items", () => {
    expect(planRemainingNeed(plan({ items: [] }))).toBe(0);
  });
});

describe("planIsOverbudget", () => {
  test("is true when paid exceeds budget", () => {
    expect(planIsOverbudget(plan({ initialBudget: 5000 }))).toBe(true);
  });

  test("is false when paid is within budget", () => {
    expect(planIsOverbudget(plan({ initialBudget: 10000 }))).toBe(false);
  });

  test("is false with no budget and no items, however much is paid", () => {
    // No figure to be over. Matches the Insights pace line, which already
    // guarded on budget > 0 while capitals.ts did not.
    const p = plan({
      items: [{ id: "i1", name: "Venue", estimatedCost: 0, paid: true, actualCost: 500 }],
    });

    expect(planIsOverbudget(p)).toBe(false);
  });
});

describe("planEffectiveBudget", () => {
  test("is the typed budget when there is one", () => {
    expect(planEffectiveBudget(plan({ initialBudget: 12000 }))).toBe(12000);
  });

  test("falls back to the sum of item estimates when none is typed", () => {
    expect(planEffectiveBudget(plan())).toBe(10000);
  });

  test("falls back for an explicit 0, which is how a cleared budget is stored", () => {
    expect(planEffectiveBudget(plan({ initialBudget: 0 }))).toBe(10000);
  });

  test("planEffectiveBudget is 0 with neither a budget nor any items", () => {
    expect(planEffectiveBudget(plan({ items: [] }))).toBe(0);
  });
});

describe("planBudgetProgress", () => {
  test("is paid divided by budget", () => {
    expect(planBudgetProgress(plan({ initialBudget: 10000 }))).toBeCloseTo(0.68);
  });

  test("planBudgetProgress falls back to the item estimates when no budget is typed", () => {
    expect(planBudgetProgress(plan())).toBeCloseTo(0.68);
  });

  test("is null with neither a budget nor any items", () => {
    expect(planBudgetProgress(plan({ items: [] }))).toBeNull();
  });

  test("can exceed 1 when overbudget", () => {
    expect(planBudgetProgress(plan({ initialBudget: 5000 }))).toBeCloseTo(1.36);
  });
});

describe("planMonthsUntilTarget", () => {
  const today = new Date(2026, 7, 21); // Aug 21, 2026

  test("returns null when there is no target date", () => {
    expect(planMonthsUntilTarget(plan(), today)).toBeNull();
  });

  test("returns null when the target month is in the past", () => {
    expect(planMonthsUntilTarget(plan({ targetDate: "2026-06-15" }), today)).toBeNull();
  });

  test("is at least 1 when the target is the current month", () => {
    expect(planMonthsUntilTarget(plan({ targetDate: "2026-08-31" }), today)).toBe(1);
  });

  test("counts whole calendar months until a future target", () => {
    expect(planMonthsUntilTarget(plan({ targetDate: "2026-11-01" }), today)).toBe(3);
  });
});

describe("planIsUpcoming", () => {
  const today = new Date(2026, 7, 21); // Aug 21, 2026

  test("is true for a future target date even when all items are paid", () => {
    const p = plan({
      targetDate: "2026-11-01",
      items: [
        { id: "i1", name: "Venue", estimatedCost: 5000, paid: true, actualCost: 5000 },
        { id: "i2", name: "Catering", estimatedCost: 3000, paid: true, actualCost: 3000 },
      ],
    });

    expect(planIsUpcoming(p, today)).toBe(true);
  });

  test("is false when there is no target date", () => {
    expect(planIsUpcoming(plan(), today)).toBe(false);
  });

  test("is false when the target month is in the past", () => {
    expect(planIsUpcoming(plan({ targetDate: "2026-06-15" }), today)).toBe(false);
  });

  test("is true when the target is the current month", () => {
    expect(planIsUpcoming(plan({ targetDate: "2026-08-31" }), today)).toBe(true);
  });
});

describe("planMonthlySave", () => {
  const today = new Date(2026, 7, 21); // Aug 21, 2026

  test("divides what is still to set aside by months until target", () => {
    // 8000 set aside covers the 6800 paid, so the need is budget − saved
    const p = plan({ id: "p1", targetDate: "2026-11-01", initialBudget: 10000 });
    const txns = [savingsTx("2026-06-01", 8000, "p1")];

    expect(planMonthlySave(p, today, txns, INDEX)).toBeCloseTo((10000 - 8000) / 3);
  });

  test("divides (budget − paid) by months until target", () => {
    // budget 10000 − paid 6800 = 3200; Aug → Nov = 3 months → ~1066.67/mo
    expect(
      planMonthlySave(plan({ targetDate: "2026-11-01", initialBudget: 10000 }), today),
    ).toBeCloseTo(3200 / 3);
  });

  test("still saves monthly when all items are paid but budget remains", () => {
    const p = plan({
      targetDate: "2026-11-01",
      initialBudget: 10000,
      items: [
        { id: "i1", name: "Venue", estimatedCost: 5000, paid: true, actualCost: 4000 },
        { id: "i2", name: "Catering", estimatedCost: 3000, paid: true, actualCost: 2000 },
      ],
    });
    // remaining 4000 / 3 months
    expect(planMonthlySave(p, today)).toBeCloseTo(4000 / 3);
  });

  test("returns null when overbudget (UI shows Overpaid)", () => {
    expect(
      planMonthlySave(plan({ targetDate: "2026-11-01", initialBudget: 5000 }), today),
    ).toBeNull();
  });

  test("returns 0 when paid exactly equals budget", () => {
    const p = plan({
      targetDate: "2026-11-01",
      initialBudget: 6800,
    });
    expect(planMonthlySave(p, today)).toBe(0);
  });

  test("returns null without a target date", () => {
    expect(planMonthlySave(plan({ initialBudget: 10000 }), today)).toBeNull();
  });

  test("returns null when the target month is past", () => {
    expect(
      planMonthlySave(plan({ targetDate: "2026-01-01", initialBudget: 10000 }), today),
    ).toBeNull();
  });

  test("returns null for a plan with neither a budget nor items", () => {
    // Previously 0, which rendered a pointless "Save 0.00/mo" on the card.
    expect(planMonthlySave(plan({ targetDate: "2026-11-01", items: [] }), today)).toBeNull();
  });
});

describe("plansTotalMonthlySave", () => {
  const today = new Date(2026, 7, 21);

  test("sums monthly save across plans and skips overbudget", () => {
    const a = plan({ id: "a", targetDate: "2026-11-01", initialBudget: 10000 });
    const b = plan({ id: "b", targetDate: "2026-11-01", initialBudget: 5000 }); // overbudget
    const c = plan({
      id: "c",
      targetDate: "2026-11-01",
      initialBudget: 9000,
      items: [{ id: "i1", name: "Trip", estimatedCost: 3000, paid: true, actualCost: 3000 }],
    });

    // a: 3200/3, b: 0 (overbudget), c: 6000/3 = 2000
    expect(plansTotalMonthlySave([a, b, c], today)).toBeCloseTo(3200 / 3 + 2000);
  });
});

describe("planProgress", () => {
  test("is the fraction of items marked paid", () => {
    expect(planProgress(plan())).toBeCloseTo(2 / 3);
  });

  test("is null for a plan with no items yet", () => {
    expect(planProgress(plan({ items: [] }))).toBeNull();
  });
});

describe("planSavedTotal", () => {
  test("sums deposits minus withdrawals for matching capitalPlanId", () => {
    const p = plan({ id: "p1" });
    const txns = [
      savingsTx("2026-06-01", 500, "p1"),
      savingsTx("2026-06-15", 300, "p1"),
      savingsTx("2026-07-01", 100, "p1", "income"),
      savingsTx("2026-07-02", 200, "p2"),
    ];

    expect(planSavedTotal(p, txns, INDEX)).toBe(700);
  });

  test("ignores non-savings transactions even with capitalPlanId", () => {
    const p = plan({ id: "p1" });
    const txns = [
      {
        ...savingsTx("2026-06-01", 500, "p1"),
        sub: "groceries",
      },
    ];
    const spendingIndex = buildCategoryIndex([
      {
        id: "food",
        name: "Food",
        color: "#5b7a8a",
        glyph: "🍽️",
        type: "expense",
        subs: [{ id: "groceries", name: "Groceries" }],
      },
      ...SAVINGS_CATEGORIES,
    ]);

    expect(planSavedTotal(p, txns, spendingIndex)).toBe(0);
  });

  test("is unmoved by paying an item — it is the gross pot", () => {
    const p = plan({ id: "p1" });
    const txns = [savingsTx("2026-06-01", 4000, "p1")];

    expect(planSavedTotal(p, txns, INDEX)).toBe(4000);
  });
});

describe("planUnspentTotal", () => {
  test("is the whole pot while nothing is paid", () => {
    const p = plan({
      id: "p1",
      items: [{ id: "i1", name: "Venue", estimatedCost: 5000, paid: false }],
    });
    const txns = [savingsTx("2026-06-01", 4000, "p1")];

    expect(planUnspentTotal(p, txns, INDEX)).toBe(4000);
  });

  test("is drawn down by paying an item", () => {
    // The reported bug: 4000 set aside, a 4000 item paid from it → pot empty.
    const p = plan({
      id: "p1",
      initialBudget: 10000,
      items: [{ id: "i1", name: "Venue", estimatedCost: 4000, paid: true, actualCost: 4000 }],
    });
    const txns = [savingsTx("2026-06-01", 4000, "p1")];

    expect(planUnspentTotal(p, txns, INDEX)).toBe(0);
  });

  test("never goes negative when payments exceed the pot", () => {
    const p = plan({ id: "p1" });
    const txns = [savingsTx("2026-06-01", 1000, "p1")];

    expect(planUnspentTotal(p, txns, INDEX)).toBe(0);
  });

  test("ignores deposits assigned to another plan", () => {
    const p = plan({
      id: "p1",
      items: [{ id: "i1", name: "Venue", estimatedCost: 5000, paid: false }],
    });
    const txns = [savingsTx("2026-06-01", 4000, "p2")];

    expect(planUnspentTotal(p, txns, INDEX)).toBe(0);
  });
});

describe("planOutOfPocket", () => {
  test("is what the pot did not cover", () => {
    const p = plan({ id: "p1" });
    const txns = [savingsTx("2026-06-01", 1000, "p1")];

    expect(planOutOfPocket(p, txns, INDEX)).toBe(5800);
  });

  test("is 0 once the pot covers every payment", () => {
    const p = plan({ id: "p1" });
    const txns = [savingsTx("2026-06-01", 8000, "p1")];

    expect(planOutOfPocket(p, txns, INDEX)).toBe(0);
  });
});

describe("planOutstandingCost", () => {
  test("is the budgeted cost not yet paid", () => {
    expect(planOutstandingCost(plan({ initialBudget: 10000 }))).toBe(3200);
  });

  test("clamps at 0 once paid meets the budget", () => {
    expect(planOutstandingCost(plan({ initialBudget: 5000 }))).toBe(0);
  });
});

describe("planMoney", () => {
  test("reports every figure for a plan that paid an item from its own pot", () => {
    const p = plan({
      id: "p1",
      initialBudget: 10000,
      items: [{ id: "i1", name: "Venue", estimatedCost: 4000, paid: true, actualCost: 4000 }],
    });
    const txns = [savingsTx("2026-06-01", 4000, "p1")];

    expect(planMoney(p, txns, INDEX)).toEqual({
      budget: 10000,
      paid: 4000,
      saved: 4000,
      unspent: 0,
      outOfPocket: 0,
      outstanding: 6000,
      remainingNeed: 6000,
    });
  });
});

describe("releaseOrphanedPlanRefs", () => {
  const live = plan({ id: "p1" });

  test("strips a capitalPlanId matching no live plan", () => {
    const txns = [savingsTx("2026-06-01", 500, "gone")];
    const [released] = releaseOrphanedPlanRefs(txns, [live]);

    expect(released!.capitalPlanId).toBeUndefined();
  });

  test("keeps a capitalPlanId that still resolves", () => {
    const txns = [savingsTx("2026-06-01", 500, "p1")];
    const [kept] = releaseOrphanedPlanRefs(txns, [live]);

    expect(kept!.capitalPlanId).toBe("p1");
  });

  test("leaves rows carrying no plan id alone", () => {
    const txns = [savingsTx("2026-06-01", 500)];

    expect(releaseOrphanedPlanRefs(txns, [live])[0]!.capitalPlanId).toBeUndefined();
  });

  test("returns the same array when nothing is orphaned, so memos hold", () => {
    const txns = [savingsTx("2026-06-01", 500, "p1"), savingsTx("2026-06-02", 100)];

    expect(releaseOrphanedPlanRefs(txns, [live])).toBe(txns);
  });

  test("releases everything when no plans have loaded", () => {
    const txns = [savingsTx("2026-06-01", 500, "p1")];

    expect(releaseOrphanedPlanRefs(txns, [])[0]!.capitalPlanId).toBeUndefined();
  });

  test("a released deposit counts toward its plan again once healed", () => {
    // The end-to-end point: an orphaned row is skipped by its piggy and claimed
    // by no plan, so it counts nowhere until the id is cleared.
    const orphaned = [savingsTx("2026-06-01", 500, "gone")];

    expect(planSavedTotal(live, orphaned, INDEX)).toBe(0);
    expect(releaseOrphanedPlanRefs(orphaned, [live])[0]!.capitalPlanId).toBeUndefined();
  });
});

describe("instantiateFromTemplate", () => {
  test("prefills item names from a built-in template with zero cost", () => {
    const items = instantiateFromTemplate("marriage");
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.estimatedCost === 0 && !i.paid)).toBe(true);
    expect(items.map((i) => i.name)).toContain("Venue");
  });

  test("every generated item id is unique", () => {
    const items = instantiateFromTemplate("house-loan");
    const ids = new Set(items.map((i) => i.id));
    expect(ids.size).toBe(items.length);
  });

  test("returns an empty list for a custom (non-template) plan", () => {
    expect(instantiateFromTemplate("custom")).toEqual([]);
  });
});
