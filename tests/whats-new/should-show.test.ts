import { shouldAutoShowWhatsNew } from "@/frontend/lib/whats-new/should-show";
import { describe, expect, test } from "bun:test";

describe("shouldAutoShowWhatsNew", () => {
  test("skips when this device already saw the version", () => {
    expect(shouldAutoShowWhatsNew({ seen: true })).toBe("skip-seen");
  });

  test("shows for a brand-new account after welcome and tour finish, or a returning account on an unseen device", () => {
    expect(shouldAutoShowWhatsNew({ seen: false })).toBe("show");
  });
});
