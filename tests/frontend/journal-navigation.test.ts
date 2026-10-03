import { describe, expect, test } from "bun:test";
import { viewFromHash } from "@/frontend/lib/journal-navigation";
import { VIEW_IDS } from "@/lib/views";

describe("journal destinations", () => {
  test("every existing destination can be restored from the URL", () => {
    for (const id of VIEW_IDS) expect(viewFromHash(`#${id}`)).toBe(id);
  });
  test("unknown and empty URLs open the journal", () => {
    for (const hash of ["", "#missing", "#javascript:alert(1)"])
      expect(viewFromHash(hash)).toBe("overview");
  });
});
