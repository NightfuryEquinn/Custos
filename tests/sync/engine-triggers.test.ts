import { describe, expect, test } from "bun:test";
import { armSyncTriggers, resetSyncTriggersForTests } from "@/frontend/lib/sync/engine";

describe("armSyncTriggers", () => {
  test("is a no-op without throwing when there is no window (bun's test runtime, or a worker)", () => {
    resetSyncTriggersForTests();
    expect(() => armSyncTriggers(() => "0xabc")).not.toThrow();
    expect(() => armSyncTriggers(() => "0xabc")).not.toThrow(); // idempotent call
    resetSyncTriggersForTests();
  });
});
