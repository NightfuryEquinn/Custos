import { describe, expect, test } from "bun:test";
import { activityRoutines, type DailyRoutine } from "../src/lib/daily";

const today = "2026-10-24";
const routine = (id: string, kind: "daily" | "weekdays" | "weekly"): DailyRoutine => ({
  id,
  title: id,
  notes: "",
  createdAt: "2026-10-01T00:00:00Z",
  schedule: [{ from: "2026-10-01", kind, ...(kind === "weekdays" ? { weekdays: [0] } : {}) }],
});
const ids = (rows: DailyRoutine[]) => rows.map((row) => row.id);

describe("Daily activity tab filtering", () => {
  test("Today includes weekday routines even on an off day; This week includes only weekly", () => {
    const rows = [
      routine("everyday", "daily"),
      routine("monday", "weekdays"),
      routine("weekly", "weekly"),
    ];
    expect(ids(activityRoutines(rows, today, "today"))).toEqual(["everyday", "monday"]);
    expect(ids(activityRoutines(rows, today, "week"))).toEqual(["weekly"]);
  });

  test("uses the effective recurrence, not a scheduled future change", () => {
    const row = routine("changing", "daily");
    row.schedule.push({ from: "2026-10-26", kind: "weekly" });
    expect(activityRoutines([row], today, "today")).toEqual([row]);
    expect(activityRoutines([row], today, "week")).toEqual([]);
    expect(activityRoutines([row], "2026-10-26", "week")).toEqual([row]);
    expect(activityRoutines([row], "2026-10-26", "today")).toEqual([]);
  });

  test("archived routines keep their recurrence at archival", () => {
    const row = { ...routine("archived", "daily"), archivedOn: "2026-10-10" };
    row.schedule.push({ from: "2026-10-12", kind: "weekly" });
    expect(activityRoutines([row], today, "today")).toEqual([row]);
    expect(activityRoutines([row], today, "week")).toEqual([]);
    const weekly = { ...routine("archived-weekly", "weekly"), archivedOn: "2026-10-10" };
    expect(activityRoutines([weekly], today, "week")).toEqual([weekly]);
  });

  test("empty and not-yet-started routines produce no history", () => {
    expect(activityRoutines([], today, "today")).toEqual([]);
    expect(activityRoutines([], today, "week")).toEqual([]);
    const row = routine("future", "daily");
    row.schedule[0]!.from = "2026-10-26";
    expect(activityRoutines([row], today, "today")).toEqual([]);
  });
});
