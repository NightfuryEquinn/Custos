import { beforeEach, describe, expect, test } from "bun:test";
import { isSessionTrustFresh, markSessionVerified } from "@/frontend/auth/lib/session-trust";

/* bun's test runtime has no browser localStorage — stub a minimal one, same
   convention as tests/crypto/biometric.test.ts and device-vault.test.ts. */
function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

let store: ReturnType<typeof fakeLocalStorage>;

beforeEach(() => {
  store = fakeLocalStorage();
  (globalThis as unknown as { localStorage: unknown }).localStorage = store;
});

describe("session-trust", () => {
  const address = "0xAbCdEf0000000000000000000000000000000001";

  test("an address never verified is not fresh", () => {
    expect(isSessionTrustFresh(address)).toBe(false);
  });

  test("a just-verified address is fresh", () => {
    markSessionVerified(address);
    expect(isSessionTrustFresh(address)).toBe(true);
  });

  test("address matching is case-insensitive", () => {
    markSessionVerified(address);
    expect(isSessionTrustFresh(address.toLowerCase())).toBe(true);
    expect(isSessionTrustFresh(address.toUpperCase())).toBe(true);
  });

  test("a stale verification (past the trust window) is not fresh", () => {
    markSessionVerified(address);
    const key = "ledger:session-verified-at";
    const map = JSON.parse(store.getItem(key)!) as Record<string, number>;
    map[address.toLowerCase()] = Date.now() - 31 * 24 * 60 * 60 * 1000;
    store.setItem(key, JSON.stringify(map));

    expect(isSessionTrustFresh(address)).toBe(false);
  });

  test("persists under a ledger:-prefixed key so clearAllLocalData sweeps it", () => {
    markSessionVerified(address);
    expect(store.getItem("ledger:session-verified-at")).not.toBeNull();
  });
});
