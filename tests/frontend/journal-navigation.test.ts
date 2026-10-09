import { describe, expect, test } from "bun:test";
import { resolveStartView, viewFromHash } from "@/frontend/lib/journal-navigation";
import { VIEW_IDS } from "@/lib/views";

describe("journal destinations", () => {
  test("every existing destination can be restored from the URL", () => {
    for (const id of VIEW_IDS) expect(viewFromHash(`#${id}`)).toBe(id);
  });
  test("unknown and empty URLs open Home", () => {
    for (const hash of ["", "#missing", "#javascript:alert(1)"])
      expect(viewFromHash(hash)).toBe("overview");
  });

  describe("resolveStartView", () => {
    test("any hash wins, even an unknown one", () => {
      for (const hash of ["#budgets", "#missing"])
        expect(resolveStartView(hash, "schedule", "todos", true)).toBeNull();
    });
    test("a saved start page wins on phone and desktop", () => {
      expect(resolveStartView("", "schedule", "todos", true)).toBe("schedule");
      expect(resolveStartView("", "schedule", "todos", false)).toBe("schedule");
    });
    test("legacy accounts keep first-favorite on phones and Home on desktop", () => {
      expect(resolveStartView("", undefined, "todos", true)).toBe("todos");
      expect(resolveStartView("", undefined, "todos", false)).toBe("overview");
    });
  });
});
