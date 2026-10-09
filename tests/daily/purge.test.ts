import { COLLECTIONS } from "@/db/collections";
import { expect, test } from "bun:test";
import { OWNED_BY_ACCOUNT_ID } from "../../scripts/lib/purge-account";

test("wiping or pruning an account also removes its Daily routines and completions", () => {
  const owned: readonly string[] = OWNED_BY_ACCOUNT_ID;

  expect(owned).toContain(COLLECTIONS.dailyRoutines);
  expect(owned).toContain(COLLECTIONS.dailyCompletions);
});
