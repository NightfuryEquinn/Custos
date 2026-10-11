import { monthLog } from "@/lib/nudge";
import { describe, expect, test } from "bun:test";

describe("monthLog", () => {
  const nudge = {
    progress: { day: "2026-10-11", count: 3 },
    history: { "2026-09-30": 8, "2026-10-02": 5, "2026-10-09": 0, "2026-10-11": 1 },
  };

  test("keeps only the month, newest first, skipping empty days", () => {
    expect(monthLog(nudge, "2026-10")).toEqual([
      ["2026-10-11", 3],
      ["2026-10-02", 5],
    ]);
    expect(monthLog(nudge, "2026-09")).toEqual([["2026-09-30", 8]]);
  });

  test("a nudge with no history still shows its current progress day", () => {
    expect(monthLog({ progress: nudge.progress }, "2026-10")).toEqual([["2026-10-11", 3]]);
    expect(monthLog({ progress: nudge.progress }, "2026-08")).toEqual([]);
  });
});
