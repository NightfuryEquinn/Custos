import {
  countToday,
  everyLabel,
  goalMet,
  nextNudgeAt,
  nudgeBody,
  type NudgeRule,
} from "@/lib/nudge";
import { describe, expect, test } from "bun:test";

const KL = "Asia/Kuala_Lumpur"; // UTC+8, no clock changes
const rule = (everyMin: number, windowStart = "08:00", windowEnd = "22:00"): NudgeRule => ({
  everyMin,
  windowStart,
  windowEnd,
});
const at = (iso: string) => Date.parse(iso);
const next = (r: NudgeRule, after: string, tz = KL) => nextNudgeAt(r, at(after), tz).toISOString();

describe("next nudge slot", () => {
  test("the next slot on the grid inside the window", () => {
    expect(next(rule(30), "2026-10-11T02:10:00Z")).toBe("2026-10-11T02:30:00.000Z"); // 10:10 -> 10:30
  });

  test("a slot exactly now is not the next one", () => {
    expect(next(rule(30), "2026-10-11T02:30:00Z")).toBe("2026-10-11T03:00:00.000Z");
  });

  test("slots stay on the window's grid, not on the time it was last sent", () => {
    // 10:07 with a 2 h interval from 08:00 -> 10:00 has passed, so 12:00.
    expect(next(rule(120), "2026-10-11T02:07:00Z")).toBe("2026-10-11T04:00:00.000Z");
  });

  test("before the window opens, the first slot is the opening time", () => {
    expect(next(rule(30), "2026-10-10T22:00:00Z")).toBe("2026-10-11T00:00:00.000Z"); // 06:00 -> 08:00
  });

  test("the closing time is itself a slot when the grid lands on it", () => {
    expect(next(rule(30), "2026-10-11T13:59:59Z")).toBe("2026-10-11T14:00:00.000Z"); // 22:00
  });

  test("after the last slot, the next one is tomorrow's opening time", () => {
    expect(next(rule(30), "2026-10-11T14:00:00Z")).toBe("2026-10-12T00:00:00.000Z");
    // 21:30 + 60 min would be 22:30, past a 22:00 close.
    expect(next(rule(60, "08:30", "22:00"), "2026-10-11T13:40:00Z")).toBe(
      "2026-10-12T00:30:00.000Z",
    );
  });

  test("a window shorter than the interval has one slot a day", () => {
    const r = rule(60, "09:00", "09:20");
    expect(next(r, "2026-10-11T00:30:00Z")).toBe("2026-10-11T01:00:00.000Z"); // 08:30 -> 09:00 today
    expect(next(r, "2026-10-11T01:00:00Z")).toBe("2026-10-12T01:00:00.000Z"); // 09:00 -> 09:00 tomorrow
  });

  test("the longest interval gives two slots in a long window", () => {
    const r = rule(720, "06:00", "23:00");
    expect(next(r, "2026-10-10T23:00:00Z")).toBe("2026-10-11T10:00:00.000Z"); // 07:00 -> 18:00
  });

  test("the window is read in the account's timezone", () => {
    // 08:30 in New York (UTC-4 in October) -> next two-hourly slot is 10:00 local.
    expect(next(rule(120), "2026-10-11T12:30:00Z", "America/New_York")).toBe(
      "2026-10-11T14:00:00.000Z",
    );
  });

  test("a clock change moves the slot's UTC time, not its local time", () => {
    // New York falls back on 2026-11-01: 08:00 local is 13:00Z that day, 12:00Z the day before.
    expect(next(rule(30), "2026-11-01T12:00:00Z", "America/New_York")).toBe(
      "2026-11-01T13:00:00.000Z",
    );
    expect(next(rule(30), "2026-10-31T11:00:00Z", "America/New_York")).toBe(
      "2026-10-31T12:00:00.000Z",
    );
  });
});

describe("daily count", () => {
  const nudge = { target: 8, progress: { day: "2026-10-11", count: 5 } };

  test("yesterday's count reads as zero today", () => {
    expect(countToday(nudge, "2026-10-11")).toBe(5);
    expect(countToday(nudge, "2026-10-12")).toBe(0);
  });

  test("the goal is met at the target, not before", () => {
    expect(goalMet(nudge, "2026-10-11")).toBe(false);
    expect(goalMet({ ...nudge, progress: { day: "2026-10-11", count: 8 } }, "2026-10-11")).toBe(
      true,
    );
    expect(goalMet({ ...nudge, progress: { day: "2026-10-11", count: 9 } }, "2026-10-11")).toBe(
      true,
    );
    expect(goalMet({ ...nudge, progress: { day: "2026-10-11", count: 9 } }, "2026-10-12")).toBe(
      false,
    );
  });
});

describe("labels", () => {
  test("an interval reads in hours and minutes", () => {
    expect(everyLabel(30)).toBe("Every 30 min");
    expect(everyLabel(120)).toBe("Every 2 h");
    expect(everyLabel(90)).toBe("Every 1 h 30 min");
  });

  test("the push body leads with the goal and appends a description when there is one", () => {
    expect(nudgeBody({ target: 8, unit: "glasses", description: "" })).toBe("8 glasses today");
    expect(nudgeBody({ target: 8, unit: "glasses", description: "  Room temperature " })).toBe(
      "8 glasses today · Room temperature",
    );
    expect(nudgeBody({ target: 3, unit: "", description: "" })).toBe("3 today");
  });
});
