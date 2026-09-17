import type { NewOutboxEntry } from "@/frontend/lib/sync/types";

export const TEST_ADDRESS = "0xAbCdEf0000000000000000000000000000000001";

/** A minimal, valid outbox entry for the shared test address, with overrides. */
export function entry(overrides: Partial<NewOutboxEntry> = {}): NewOutboxEntry {
  return {
    address: TEST_ADDRESS,
    entity: "expense",
    op: "create",
    targetId: "target-1",
    request: { method: "POST", path: "/expenses", body: { note: "coffee" } },
    dependsOn: [],
    ...overrides,
  };
}
