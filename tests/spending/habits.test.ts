import { describe, expect, test } from "bun:test";
import {
  HABIT_MIN_ACTIVE_DAYS,
  HABIT_STYLES,
  assessSpendingHabit,
  computeHabitMetrics,
  describeHabitShift,
  habitBlend,
  habitPeriodExpenses,
  habitTrajectory,
  pickHabitStyle,
  rankStyles,
  scoreHabitStyles,
  type HabitStyleId,
} from "@/frontend/lib/spendingHabits";
import type { Expense } from "@/frontend/lib/types";

/** Build a minimal outgoing expense for habit tests. */
function tx(date: string, amount: number, id = date + amount): Expense {
  return {
    id,
    walletId: "w1",
    kind: "expense",
    date,
    sub: "food-groceries",
    amount,
    note: "",
    recurring: false,
  };
}

/** All six archetype fixtures from the `scoreHabitStyles` describe block below, reused for
 * regression checks. */
const ARCHETYPE_FIXTURES: Record<HabitStyleId, Expense[]> = {
  clockwork: [
    tx("2026-07-01", 49.99),
    tx("2026-07-08", 49.99),
    tx("2026-07-15", 49.99),
    tx("2026-07-22", 49.99),
    tx("2026-07-29", 49.99),
  ],
  burst: [
    tx("2026-07-01", 8),
    tx("2026-07-02", 5),
    tx("2026-07-08", 12),
    tx("2026-07-18", 90, "b1"),
    tx("2026-07-18", 45, "b2"),
    tx("2026-07-18", 120, "b3"),
    tx("2026-07-19", 75, "b4"),
    tx("2026-07-19", 33, "b5"),
    tx("2026-07-19", 210, "b6"),
  ],
  dripper: Array.from({ length: 22 }, (_, i) => {
    const d = i + 1;
    const day = String(d).padStart(2, "0");
    return tx(`2026-07-${day}`, 4 + (d % 5), `d${d}`);
  }),
  peakValley: [
    tx("2026-07-01", 320),
    tx("2026-07-02", 180),
    tx("2026-07-03", 95),
    tx("2026-07-08", 40),
    tx("2026-07-15", 18),
    tx("2026-07-22", 8),
    tx("2026-07-28", 4),
  ],
  accumulator: [
    tx("2026-07-04", 180),
    tx("2026-07-11", 210),
    tx("2026-07-18", 195),
    tx("2026-07-25", 240),
    tx("2026-07-25", 85, "extra"),
  ],
  nomad: [
    tx("2026-07-01", 2),
    tx("2026-07-03", 480),
    tx("2026-07-06", 17),
    tx("2026-07-10", 3),
    tx("2026-07-11", 220),
    tx("2026-07-16", 9),
    tx("2026-07-20", 55),
    tx("2026-07-24", 4),
    tx("2026-07-29", 310),
  ],
};

describe("assessSpendingHabit", () => {
  test("stays locked until five distinct transaction days", () => {
    const expenses = [
      tx("2026-07-01", 10),
      tx("2026-07-02", 12),
      tx("2026-07-03", 8),
      tx("2026-07-04", 9),
    ];
    const result = assessSpendingHabit(expenses, "month", "2026-07");
    expect(result.status).toBe("insufficient");
    if (result.status === "insufficient") {
      expect(result.daysHave).toBe(4);
      expect(result.daysNeeded).toBe(HABIT_MIN_ACTIVE_DAYS);
    }
  });

  test("unlocks on the fifth active day for the selected month", () => {
    const expenses = [
      tx("2026-07-01", 10),
      tx("2026-07-02", 12),
      tx("2026-07-03", 8),
      tx("2026-07-04", 9),
      tx("2026-07-05", 11),
    ];
    const result = assessSpendingHabit(expenses, "month", "2026-07");
    expect(result.status).toBe("ready");
  });

  test("month and year assessments use different windows", () => {
    const expenses = [
      tx("2026-01-01", 40),
      tx("2026-01-08", 40),
      tx("2026-01-15", 40),
      tx("2026-01-22", 40),
      tx("2026-01-29", 40),
      tx("2026-07-01", 5),
      tx("2026-07-02", 6),
      tx("2026-07-03", 4),
      tx("2026-07-04", 5),
      tx("2026-07-05", 7),
      tx("2026-07-06", 5),
      tx("2026-07-07", 6),
      tx("2026-07-08", 5),
      tx("2026-07-09", 4),
      tx("2026-07-10", 5),
      tx("2026-07-11", 6),
      tx("2026-07-12", 5),
      tx("2026-07-13", 4),
      tx("2026-07-14", 5),
      tx("2026-07-15", 6),
      tx("2026-07-16", 5),
      tx("2026-07-17", 4),
      tx("2026-07-18", 5),
      tx("2026-07-19", 6),
      tx("2026-07-20", 5),
    ];

    const month = assessSpendingHabit(expenses, "month", "2026-07");
    const year = assessSpendingHabit(expenses, "year", "2026-07");
    expect(month.status).toBe("ready");
    expect(year.status).toBe("ready");
    if (month.status === "ready" && year.status === "ready") {
      expect(month.style.id).toBe("dripper");
      expect(year.metrics.txCount).toBeGreaterThan(month.metrics.txCount);
    }
  });
});

describe("scoreHabitStyles", () => {
  test("detects clockwork fixed-interval equal amounts", () => {
    const expenses = [
      tx("2026-07-01", 49.99),
      tx("2026-07-08", 49.99),
      tx("2026-07-15", 49.99),
      tx("2026-07-22", 49.99),
      tx("2026-07-29", 49.99),
    ];
    const scores = scoreHabitStyles(expenses);
    expect(pickHabitStyle(scores)).toBe("clockwork");
  });

  test("detects burst clusters after quiet stretches", () => {
    const expenses = [
      tx("2026-07-01", 8),
      tx("2026-07-02", 5),
      tx("2026-07-08", 12),
      tx("2026-07-18", 90, "b1"),
      tx("2026-07-18", 45, "b2"),
      tx("2026-07-18", 120, "b3"),
      tx("2026-07-19", 75, "b4"),
      tx("2026-07-19", 33, "b5"),
      tx("2026-07-19", 210, "b6"),
    ];
    const scores = scoreHabitStyles(expenses);
    expect(pickHabitStyle(scores)).toBe("burst");
  });

  test("detects steady dripper micro-spending", () => {
    const expenses: Expense[] = [];
    for (let d = 1; d <= 22; d++) {
      const day = String(d).padStart(2, "0");
      expenses.push(tx(`2026-07-${day}`, 4 + (d % 5), `d${d}`));
    }
    const scores = scoreHabitStyles(expenses);
    expect(pickHabitStyle(scores)).toBe("dripper");
  });

  test("detects peak-and-valley payday taper", () => {
    const expenses = [
      tx("2026-07-01", 320),
      tx("2026-07-02", 180),
      tx("2026-07-03", 95),
      tx("2026-07-08", 40),
      tx("2026-07-15", 18),
      tx("2026-07-22", 8),
      tx("2026-07-28", 4),
    ];
    const scores = scoreHabitStyles(expenses);
    expect(pickHabitStyle(scores)).toBe("peakValley");
  });

  test("detects calculated accumulator on one weekday", () => {
    // All Saturdays in July 2026: 4, 11, 18, 25
    const expenses = [
      tx("2026-07-04", 180),
      tx("2026-07-11", 210),
      tx("2026-07-18", 195),
      tx("2026-07-25", 240),
      tx("2026-07-25", 85, "extra"),
    ];
    const scores = scoreHabitStyles(expenses);
    expect(pickHabitStyle(scores)).toBe("accumulator");
  });

  test("detects erratic nomad irregular pattern", () => {
    const expenses = [
      tx("2026-07-01", 2),
      tx("2026-07-03", 480),
      tx("2026-07-06", 17),
      tx("2026-07-10", 3),
      tx("2026-07-11", 220),
      tx("2026-07-16", 9),
      tx("2026-07-20", 55),
      tx("2026-07-24", 4),
      tx("2026-07-29", 310),
    ];
    const scores = scoreHabitStyles(expenses);
    expect(pickHabitStyle(scores)).toBe("nomad");
  });
});

describe("computeHabitMetrics", () => {
  test("counts transactions and distinct active days", () => {
    const { metrics } = computeHabitMetrics(ARCHETYPE_FIXTURES.clockwork);
    expect(metrics.txCount).toBe(ARCHETYPE_FIXTURES.clockwork.length);
    expect(metrics.activeDays).toBe(new Set(ARCHETYPE_FIXTURES.clockwork.map((e) => e.date)).size);
  });

  test("an empty list yields empty signals", () => {
    const { metrics } = computeHabitMetrics([]);
    expect(metrics).toEqual({ txCount: 0, activeDays: 0, topDowShare: 0, topDowSampleDate: "" });
  });

  test("topDow concentration matches a single-weekday fixture", () => {
    // All Saturdays in July 2026.
    const { metrics } = computeHabitMetrics(ARCHETYPE_FIXTURES.accumulator);
    expect(metrics.topDowShare).toBeGreaterThan(0.5);
    expect(new Date(metrics.topDowSampleDate + "T00:00:00").getDay()).toBe(6);
  });
});

describe("habit chart tags", () => {
  test("every style has a four-letter chart tag", () => {
    for (const style of Object.values(HABIT_STYLES)) {
      expect(style.tag).toMatch(/^[A-Z]{4}$/);
    }
  });
});

describe("scoreHabitStyles backward compatibility", () => {
  for (const [id, fixture] of Object.entries(ARCHETYPE_FIXTURES) as [HabitStyleId, Expense[]][]) {
    test(`${id} fixture: scoreHabitStyles matches computeHabitMetrics().scores`, () => {
      const direct = scoreHabitStyles(fixture);
      const { scores } = computeHabitMetrics(fixture);
      expect(direct).toEqual(scores);
      expect(Object.keys(direct).sort()).toEqual(Object.keys(HABIT_STYLES).sort());
    });
  }

  test("unsorted input yields identical scores and signals to the sorted original", () => {
    const sortedFixture = ARCHETYPE_FIXTURES.clockwork;
    const shuffled = [
      sortedFixture[4]!,
      sortedFixture[1]!,
      sortedFixture[3]!,
      sortedFixture[0]!,
      sortedFixture[2]!,
    ];
    const a = computeHabitMetrics(sortedFixture);
    const b = computeHabitMetrics(shuffled);
    expect(b.scores).toEqual(a.scores);
    expect(b.metrics).toEqual(a.metrics);
  });
});

describe("habitConfidence", () => {
  test("a bare 5-day month reads low confidence", () => {
    const expenses = [
      tx("2026-07-01", 10),
      tx("2026-07-02", 12),
      tx("2026-07-03", 8),
      tx("2026-07-04", 9),
      tx("2026-07-05", 11),
    ];
    const result = assessSpendingHabit(expenses, "month", "2026-07");
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.confidence.level).toBe("low");
  });

  test("a well-sampled, clearly-led month reads high confidence", () => {
    const result = assessSpendingHabit(ARCHETYPE_FIXTURES.dripper, "month", "2026-07");
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.confidence.level).toBe("high");
  });
});

describe("habitBlend", () => {
  test("assessSpendingHabit wires the blend field through from the ranked scores", () => {
    // Equal-amount, evenly-spaced fixtures tend to score well on more than one
    // archetype at once (clockwork's cadence also reads as a taper to peakValleyScore),
    // so this only checks the field is populated and self-consistent — the threshold
    // logic itself is covered directly against habitBlend below.
    const result = assessSpendingHabit(ARCHETYPE_FIXTURES.clockwork, "month", "2026-07");
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.blend.label).toContain(result.style.title);
      if (result.blend.secondary) {
        expect(result.blend.label).toContain(result.blend.secondary.trait);
      } else {
        expect(result.blend.weight).toBe(0);
      }
    }
  });

  test("a close runner-up qualifies as a secondary trait", () => {
    const ranked = rankStyles({
      clockwork: 0.5,
      burst: 0.3,
      dripper: 0.1,
      peakValley: 0.05,
      accumulator: 0.03,
      nomad: 0.02,
    });
    const blend = habitBlend(ranked);
    expect(blend.secondary?.id).toBe("burst");
    expect(blend.label).toContain(blend.secondary!.trait);
  });

  test("a distant runner-up does not qualify", () => {
    const ranked = rankStyles({
      clockwork: 0.5,
      burst: 0.1,
      dripper: 0.05,
      peakValley: 0.03,
      accumulator: 0.02,
      nomad: 0.01,
    });
    expect(habitBlend(ranked).secondary).toBeNull();
  });
});

describe("rolling 90-day window", () => {
  const straddle = [
    tx("2021-11-01", 15, "old"),
    tx("2022-02-24", 10, "f1"),
    tx("2022-02-25", 10, "f2"),
    tx("2022-02-26", 10, "f3"),
    tx("2022-02-27", 10, "f4"),
    tx("2022-02-28", 10, "f5"),
    tx("2022-03-01", 10, "m1"),
    tx("2022-03-02", 10, "m2"),
    tx("2022-03-03", 10, "m3"),
    tx("2022-03-04", 10, "m4"),
    tx("2022-03-05", 10, "m5"),
  ];

  test("splits across a month boundary under 'month'", () => {
    expect(habitPeriodExpenses(straddle, "month", "2022-02")).toHaveLength(5);
    expect(habitPeriodExpenses(straddle, "month", "2022-03")).toHaveLength(5);
  });

  test("spans the boundary under 'rolling90', excluding transactions past the window", () => {
    const rolling = habitPeriodExpenses(straddle, "rolling90", "2022-03");
    expect(rolling).toHaveLength(10);
    expect(rolling.some((e) => e.id === "old")).toBe(false);
  });
});

describe("habitTrajectory", () => {
  const points = [
    // Jan: clockwork
    tx("2026-01-01", 40),
    tx("2026-01-08", 40),
    tx("2026-01-15", 40),
    tx("2026-01-22", 40),
    tx("2026-01-29", 40),
    // Feb: clockwork
    tx("2026-02-02", 40),
    tx("2026-02-08", 40),
    tx("2026-02-14", 40),
    tx("2026-02-20", 40),
    tx("2026-02-26", 40),
    // Mar: insufficient (only 3 active days)
    tx("2026-03-01", 40),
    tx("2026-03-02", 40),
    tx("2026-03-03", 40),
    // Apr: clockwork
    tx("2026-04-01", 40),
    tx("2026-04-08", 40),
    tx("2026-04-15", 40),
    tx("2026-04-22", 40),
    tx("2026-04-29", 40),
    // May: clockwork
    tx("2026-05-01", 40),
    tx("2026-05-08", 40),
    tx("2026-05-15", 40),
    tx("2026-05-22", 40),
    tx("2026-05-29", 40),
    // Jun: dripper (anchor month)
    ...Array.from({ length: 22 }, (_, i) =>
      tx(`2026-06-${String(i + 1).padStart(2, "0")}`, 4 + (i % 5), `j${i}`),
    ),
  ];

  test("covers the trailing 6 months, marking the sparse month insufficient", () => {
    const trail = habitTrajectory(points, "2026-06");
    expect(trail).toHaveLength(6);
    expect(trail.map((p) => p.monthKey)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(trail[2]!.status).toBe("insufficient");
    expect(trail[2]!.styleId).toBeNull();
    expect(trail[0]!.status).toBe("ready");
    expect(trail[0]!.styleId).toBe("clockwork");
    expect(trail[0]!.tag).toBe("CLCK");
    expect(trail[5]!.status).toBe("ready");
    expect(trail[5]!.styleId).toBe("dripper");
    expect(trail[5]!.tag).toBe("DRIP");
  });

  test("describeHabitShift names both styles across a transition", () => {
    const trail = habitTrajectory(points, "2026-06");
    const shift = describeHabitShift(trail);
    expect(shift).toContain(HABIT_STYLES.clockwork.title);
    expect(shift).toContain(HABIT_STYLES.dripper.title);
  });

  test("describeHabitShift reports insufficient history for under two ready months", () => {
    const shift = describeHabitShift([
      { monthKey: "2026-06", status: "ready", styleId: "clockwork", tag: "CLCK", spend: 100 },
      { monthKey: "2026-05", status: "insufficient", styleId: null, tag: "", spend: 20 },
    ]);
    expect(shift).toBe("Not enough history to compare yet.");
  });
});
