import {
  DAILY_POINTS,
  computeStreak,
  currentPeriod,
  dueRows,
  editSchedule,
  idleRoutines,
  msUntilNextDay,
  newRoutine,
  periodOf,
  points,
  progressOf,
  scheduleAt,
  streakUnit,
  weekStart,
  type DailyCompletion,
  type DailyRoutine,
  type DailySchedule,
} from "@/lib/daily";
import { describe, expect, test } from "bun:test";

const NOW = "2026-10-09T08:00:00.000Z";
const done = (...keys: string[]) => new Set(keys);
const routine = (schedule: DailySchedule[], extra: Partial<DailyRoutine> = {}): DailyRoutine => ({
  id: "r1",
  title: "Stretch",
  notes: "",
  schedule,
  createdAt: NOW,
  ...extra,
});
const daily = (from: string): DailySchedule => ({ from, kind: "daily" });
const weekly = (from: string): DailySchedule => ({ from, kind: "weekly" });
const weekdays = (from: string, days: number[]): DailySchedule => ({
  from,
  kind: "weekdays",
  weekdays: days,
});

describe("period keys", () => {
  test("a week is keyed by its Monday, across a year boundary", () => {
    // 2026-12-31 is a Thursday; 2027-01-03 is the Sunday of the same week.
    expect(weekStart("2026-12-31")).toBe("2026-12-28");
    expect(weekStart("2027-01-03")).toBe("2026-12-28");
    expect(weekStart("2027-01-04")).toBe("2027-01-04");
  });

  test("a day routine keys by date and a weekly routine by Monday", () => {
    expect(periodOf("daily", "2026-10-09")).toBe("2026-10-09");
    expect(periodOf("weekdays", "2026-10-09")).toBe("2026-10-09");
    expect(periodOf("weekly", "2026-10-09")).toBe("2026-10-05");
  });
});

describe("schedule lookup", () => {
  test("the last entry that has started applies; none before the routine begins", () => {
    const h = [daily("2026-10-01"), weekly("2026-10-12")];

    expect(scheduleAt(h, "2026-09-30")).toBeNull();
    expect(scheduleAt(h, "2026-10-11")?.kind).toBe("daily");
    expect(scheduleAt(h, "2026-10-12")?.kind).toBe("weekly");
  });

  test("a weekday routine is due only on its selected days", () => {
    const r = routine([weekdays("2026-10-05", [0, 2])]); // Mon, Wed
    expect(currentPeriod(r, "2026-10-05")).toBe("2026-10-05"); // Monday
    expect(currentPeriod(r, "2026-10-06")).toBeNull(); // Tuesday
    expect(currentPeriod(r, "2026-10-07")).toBe("2026-10-07"); // Wednesday
  });

  test("a weekly routine is due all week under its Monday key", () => {
    const r = routine([weekly("2026-10-05")]);
    expect(currentPeriod(r, "2026-10-05")).toBe("2026-10-05");
    expect(currentPeriod(r, "2026-10-11")).toBe("2026-10-05");
  });

  test("an archived routine, or one that has not started, is not due", () => {
    expect(
      currentPeriod(routine([daily("2026-10-09")], { archivedOn: "2026-10-09" }), "2026-10-09"),
    ).toBeNull();
    expect(currentPeriod(routine([daily("2026-10-10")]), "2026-10-09")).toBeNull();
  });
});

describe("new routines", () => {
  test("a daily routine starts today, a weekly one this week, with no history owed", () => {
    expect(newRoutine({ title: "a", kind: "daily" }, "2026-10-09", NOW).schedule).toEqual([
      daily("2026-10-09"),
    ]);
    expect(newRoutine({ title: "a", kind: "weekly" }, "2026-10-09", NOW).schedule).toEqual([
      weekly("2026-10-05"),
    ]);
  });

  test("a weekday routine made on an unscheduled day is first due on the next scheduled day", () => {
    const r = {
      ...newRoutine({ title: "a", kind: "weekdays", weekdays: [0] }, "2026-10-10", NOW),
      id: "r",
    };
    expect(currentPeriod(r, "2026-10-10")).toBeNull();
    expect(currentPeriod(r, "2026-10-12")).toBe("2026-10-12");
  });
});

describe("streaks", () => {
  test("consecutive daily completions build the streak, today included", () => {
    const r = routine([daily("2026-10-05")]);
    const s = computeStreak(r, done("2026-10-05", "2026-10-06", "2026-10-07"), "2026-10-07");
    expect(s).toEqual({ current: 3, best: 3 });
  });

  test("an unfinished today does not break the streak", () => {
    const r = routine([daily("2026-10-05")]);
    const s = computeStreak(r, done("2026-10-05", "2026-10-06"), "2026-10-07");
    expect(s).toEqual({ current: 2, best: 2 });
  });

  test("a missed day resets the current streak but keeps the best", () => {
    const r = routine([daily("2026-10-01")]);
    const s = computeStreak(
      r,
      done("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05"),
      "2026-10-05",
    );
    expect(s).toEqual({ current: 1, best: 3 });
  });

  test("a weekday routine ignores unscheduled days", () => {
    const r = routine([weekdays("2026-10-05", [0, 2, 4])]); // Mon Wed Fri
    const s = computeStreak(
      r,
      done("2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12"),
      "2026-10-12",
    );
    expect(s).toEqual({ current: 4, best: 4 });
  });

  test("a weekly routine counts weeks, and an open week is not yet a miss", () => {
    const r = routine([weekly("2026-09-21")]);
    const keys = done("2026-09-21", "2026-09-28");
    expect(computeStreak(r, keys, "2026-10-07")).toEqual({ current: 2, best: 2 }); // week of 10-05 still open
    expect(computeStreak(r, keys, "2026-10-12")).toEqual({ current: 0, best: 2 }); // 10-05 week closed unfinished
  });

  test("a streak runs across a year boundary", () => {
    const r = routine([daily("2026-12-30")]);
    const s = computeStreak(r, done("2026-12-30", "2026-12-31", "2027-01-01"), "2027-01-01");
    expect(s.current).toBe(3);
  });

  test("archiving freezes the streak, and the archive day's open period is not a miss", () => {
    const r = routine([daily("2026-10-01")], { archivedOn: "2026-10-03" });
    const s = computeStreak(r, done("2026-10-01", "2026-10-02"), "2026-10-20");
    expect(s).toEqual({ current: 2, best: 2 });
  });

  test("a schedule change keeps earlier occurrences on their original schedule", () => {
    // Daily until Sun 10-11, weekly from Mon 10-12: Mon-Sun week of 10-12 needs one completion.
    const r = routine([daily("2026-10-08"), weekly("2026-10-12")]);
    const s = computeStreak(
      r,
      done("2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"),
      "2026-10-13",
    );
    expect(s).toEqual({ current: 5, best: 5 });
  });

  test("the streak unit follows the current schedule", () => {
    expect(streakUnit(routine([daily("2026-10-01")]), "2026-10-09")).toBe("day");
    expect(streakUnit(routine([daily("2026-10-01"), weekly("2026-10-12")]), "2026-10-09")).toBe(
      "day",
    );
    expect(streakUnit(routine([weekly("2026-10-05")]), "2026-10-09")).toBe("week");
  });
});

describe("points", () => {
  const c = (period: string, d: boolean): DailyCompletion => ({
    id: `r1:${period}`,
    routineId: "r1",
    period,
    done: d,
    at: NOW,
  });

  test("each completed occurrence earns the same points; undone ones earn none", () => {
    expect(points([c("2026-10-05", true), c("2026-10-06", true), c("2026-10-07", false)])).toBe(
      2 * DAILY_POINTS,
    );
  });

  test("undo then recheck the same period never accumulates extra points", () => {
    const history = [c("2026-10-05", true)];
    expect(points(history)).toBe(DAILY_POINTS);
    expect(points([c("2026-10-05", false)])).toBe(0);
    expect(points([c("2026-10-05", true)])).toBe(DAILY_POINTS);
  });
});

describe("editing a schedule", () => {
  test("with nothing completed yet, the schedule is simply replaced", () => {
    const h = editSchedule([daily("2026-10-01")], { kind: "weekly" }, "2026-10-09", false);
    expect(h).toEqual([weekly("2026-10-05")]);
  });

  test("daily to weekly takes effect next Monday and keeps the earlier days daily", () => {
    const h = editSchedule([daily("2026-10-01")], { kind: "weekly" }, "2026-10-07", true);
    expect(h).toEqual([daily("2026-10-01"), weekly("2026-10-12")]);
  });

  test("weekly to daily takes effect next Monday, leaving this week weekly", () => {
    const h = editSchedule([weekly("2026-10-05")], { kind: "daily" }, "2026-10-07", true);
    expect(h).toEqual([weekly("2026-10-05"), daily("2026-10-12")]);
  });

  test("daily to selected weekdays takes effect tomorrow", () => {
    const h = editSchedule(
      [daily("2026-10-01")],
      { kind: "weekdays", weekdays: [1] },
      "2026-10-07",
      true,
    );
    expect(h).toEqual([daily("2026-10-01"), weekdays("2026-10-08", [1])]);
  });

  test("editing again before it takes effect replaces the pending change; matching current cancels it", () => {
    const first = editSchedule([daily("2026-10-01")], { kind: "weekly" }, "2026-10-07", true);
    const second = editSchedule(first, { kind: "weekdays", weekdays: [0] }, "2026-10-07", true);
    expect(second).toEqual([daily("2026-10-01"), weekdays("2026-10-08", [0])]);

    expect(editSchedule(first, { kind: "daily" }, "2026-10-07", true)).toEqual([
      daily("2026-10-01"),
    ]);
  });
});

describe("midnight rollover", () => {
  test("counts the time left in the local day, not the UTC day", () => {
    // 23:00 local in Kuala Lumpur (UTC+8) is one hour before the day changes.
    const now = Date.parse("2026-10-09T15:00:00.000Z");
    expect(msUntilNextDay("2026-10-09", "Asia/Kuala_Lumpur", now)).toBe(60 * 60 * 1000);
  });

  test("a daylight-saving day is 23 hours long where clocks spring forward", () => {
    // New York: 2026-03-08 00:00 EST is 05:00Z; the next local midnight is 04:00Z (EDT).
    const now = Date.parse("2026-03-08T05:00:00.000Z");
    expect(msUntilNextDay("2026-03-08", "America/New_York", now)).toBe(23 * 60 * 60 * 1000);
  });
});

describe("due rows", () => {
  const today = "2026-10-07"; // Wednesday
  const done = (r: DailyRoutine, period: string, d = true): DailyCompletion => ({
    id: `${r.id}:${period}`,
    routineId: r.id,
    period,
    done: d,
    at: NOW,
  });
  const a = routine([daily("2026-10-05")], {
    id: "a",
    title: "A",
    createdAt: "2026-10-05T00:00:00Z",
  });
  const b = routine([weekdays("2026-10-05", [0])], { id: "b", title: "B" }); // Mondays only
  const c = routine([weekly("2026-10-05")], { id: "c", title: "C" });
  const d = routine([daily("2026-10-05")], { id: "d", title: "D", archivedOn: "2026-10-06" });

  test("Today lists daily routines and weekday routines due today, never weekly or archived ones", () => {
    const rows = dueRows([a, b, c, d], [], today, "today");
    expect(rows.map((r) => r.routine.id)).toEqual(["a"]);
  });

  test("This week lists weekly routines under the week's Monday key", () => {
    const rows = dueRows([a, b, c, d], [], today, "week");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: "2026-10-05", done: false });
  });

  test("completed rows sort after incomplete ones, and carry their streak", () => {
    const e = routine([daily("2026-10-05")], {
      id: "e",
      title: "E",
      createdAt: "2026-10-05T01:00:00Z",
    });
    const rows = dueRows(
      [a, e],
      [done(a, "2026-10-05"), done(a, "2026-10-06"), done(a, "2026-10-07")],
      today,
      "today",
    );

    expect(rows.map((r) => [r.routine.id, r.done])).toEqual([
      ["e", false],
      ["a", true],
    ]);
    expect(rows[1]!.streak).toEqual({ current: 3, best: 3 });
    expect(rows[1]!.unit).toBe("day");
  });

  test("an unchecked completion row counts as not done", () => {
    const rows = dueRows([a], [done(a, "2026-10-07", false)], today, "today");
    expect(rows[0]!.done).toBe(false);
  });
});

describe("progress", () => {
  test("counts what is done out of what is due, for one tab", () => {
    const a = routine([daily("2026-10-05")], { id: "a" });
    const e = routine([daily("2026-10-05")], { id: "e" });
    const rows = dueRows(
      [a, e],
      [{ id: "a:2026-10-07", routineId: "a", period: "2026-10-07", done: true, at: NOW }],
      "2026-10-07",
      "today",
    );

    expect(progressOf(rows)).toEqual({ done: 1, total: 2 });
  });
});

describe("routines not due today", () => {
  const today = "2026-10-10"; // Saturday
  const monOnly = routine([weekdays("2026-10-10", [0])], { id: "m", title: "Gym" });
  const everyDay = routine([daily("2026-10-05")], { id: "d" });
  const archivedDaily = routine([daily("2026-10-05")], { id: "x", archivedOn: "2026-10-08" });

  test("an active weekday routine on an off day is listed so it can still be edited or archived", () => {
    expect(idleRoutines([monOnly, everyDay, archivedDaily], today).map((r) => r.id)).toEqual(["m"]);
  });

  test("it leaves the list on a day it is due", () => {
    expect(idleRoutines([monOnly], "2026-10-12")).toEqual([]);
  });

  test("a routine whose first period has not started yet is also listed", () => {
    const later = routine([daily("2026-10-12")], { id: "l" });
    expect(idleRoutines([later], today).map((r) => r.id)).toEqual(["l"]);
  });
});
