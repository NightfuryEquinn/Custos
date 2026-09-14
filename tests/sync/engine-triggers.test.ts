import { describe, expect, test } from "bun:test";
import { armSyncTriggers, resetSyncTriggersForTests } from "@/frontend/lib/sync/engine";

/*
 * Necessarily weak: bun's test runtime has no `window`/`document`, so
 * armSyncTriggers' DOM listeners/heartbeat never actually attach here and
 * a call-with-a-different-getAddress can't be exercised end-to-end without
 * a jsdom-style environment this repo doesn't otherwise use. The actual
 * security property this function's fix protects — that a stale `getAddress`
 * closure never results in one account's writes draining under a different
 * account's session — is independently covered at the `drainOutbox` level in
 * engine.test.ts (its own session-match guard refuses to send regardless of
 * which closure called it), which is the layer that matters for a real
 * exploit even if this wiring regressed again.
 */
describe("armSyncTriggers", () => {
  test("is a no-op without throwing when there is no window (bun's test runtime, or a worker)", () => {
    resetSyncTriggersForTests();
    expect(() => armSyncTriggers(() => "0xabc")).not.toThrow();
    expect(() => armSyncTriggers(() => "0xdef")).not.toThrow(); // a later call with a *different* getAddress
    resetSyncTriggersForTests();
  });
});
