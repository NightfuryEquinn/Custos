import { ledgerKeyStore, seriesKeyStore } from "@/frontend/lib/crypto/key-store";
import { forgetUnlock, rememberUnlock, restoreUnlock } from "@/frontend/lib/crypto/unlock-persist";
import { beforeEach, describe, expect, test } from "bun:test";
import { resetFakeIdb } from "../helpers/fake-idb";

const ADDR = "0xAbC0000000000000000000000000000000000001";

async function unlockMemory() {
  ledgerKeyStore.set(
    ADDR,
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]),
  );
  seriesKeyStore.set(
    ADDR,
    await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  );
}

describe("unlock persistence", () => {
  beforeEach(() => {
    resetFakeIdb();
    ledgerKeyStore.clear();
    seriesKeyStore.clear();
  });

  test("a remembered unlock is restored after the in-memory keys are gone", async () => {
    await unlockMemory();
    await rememberUnlock(ADDR);
    ledgerKeyStore.clear();
    seriesKeyStore.clear();

    expect(await restoreUnlock(ADDR.toLowerCase())).toBe(true);
    expect(ledgerKeyStore.isUnlocked(ADDR)).toBe(true);
    expect(seriesKeyStore.get(ADDR)).not.toBeNull();
  });

  test("an expired unlock is refused and dropped", async () => {
    await unlockMemory();
    const realNow = Date.now;
    try {
      Date.now = () => realNow() - 7 * 60 * 60 * 1000;
      await rememberUnlock(ADDR);
    } finally {
      Date.now = realNow;
    }
    ledgerKeyStore.clear();
    seriesKeyStore.clear();

    expect(await restoreUnlock(ADDR)).toBe(false);
    expect(ledgerKeyStore.isUnlocked(ADDR)).toBe(false);
  });

  test("forgetting removes the remembered unlock", async () => {
    await unlockMemory();
    await rememberUnlock(ADDR);
    await forgetUnlock();
    ledgerKeyStore.clear();

    expect(await restoreUnlock(ADDR)).toBe(false);
  });
});
