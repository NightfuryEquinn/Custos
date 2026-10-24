import { afterEach, expect, mock, setSystemTime, test } from "bun:test";
import { ledgerKeyStore, seriesKeyStore } from "../src/frontend/lib/crypto/key-store";

type Row = { address: string; key: CryptoKey; seriesKey: CryptoKey; expiresAt: number };
const rows = new Map<string, Row>();
mock.module("../src/frontend/lib/pwa/idb", () => ({
  STORES: { unlock: "unlock" },
  openCustosDb: async () => ({
    transaction: () => ({
      objectStore: () => ({
        put: (row: Row) => rows.set(row.address, row),
        get: (address: string) => rows.get(address),
        delete: (address: string) => rows.delete(address),
        clear: () => rows.clear(),
      }),
    }),
  }),
  reqAsPromise: async (value: unknown) => value,
  txAsPromise: async () => {},
}));
const { rememberUnlock, restoreUnlock, forgetUnlock } =
  await import("../src/frontend/lib/crypto/unlock-persist");

afterEach(() => {
  rows.clear();
  setSystemTime();
});

async function unlock(address = "account") {
  ledgerKeyStore.set(
    address,
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
  );
  seriesKeyStore.set(
    address,
    await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  );
  await rememberUnlock(address);
}

test("restores at eleven hours and expires exactly twelve hours after unlock", async () => {
  const start = Date.UTC(2026, 9, 24);
  setSystemTime(start);
  await unlock();
  setSystemTime(start + 11 * 3_600_000);
  expect(await restoreUnlock("account")).toBe(true);
  // Restoring does not renew the original expiry.
  setSystemTime(start + 12 * 3_600_000);
  expect(await restoreUnlock("account")).toBe(false);
  expect(rows.has("account")).toBe(false);
});
test("old remembered rows retain their stored six-hour expiry", async () => {
  const start = Date.UTC(2026, 9, 24);
  setSystemTime(start);
  await unlock();
  rows.get("account")!.expiresAt = start + 6 * 3_600_000;
  setSystemTime(start + 7 * 3_600_000);
  expect(await restoreUnlock("account")).toBe(false);
});
test("forgetting one account and clearing local unlock data revoke restoration", async () => {
  await unlock("one");
  await unlock("two");
  await forgetUnlock("one");
  expect(await restoreUnlock("one")).toBe(false);
  expect(await restoreUnlock("two")).toBe(true);
  await forgetUnlock();
  expect(await restoreUnlock("two")).toBe(false);
});
