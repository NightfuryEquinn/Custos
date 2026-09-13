import { beforeEach, describe, expect, test } from "bun:test";
import {
  biometricAutoUnlockIdentity,
  biometricEnrolled,
  disableBiometric,
  enrollBiometric,
  unlockWithBiometric,
} from "@/frontend/auth/lib/biometric";

/*
 * bun's test runtime has no browser globals — stub just enough of
 * localStorage + WebAuthn (navigator.credentials, PublicKeyCredential) for
 * biometric.ts to run against.
 */

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

function fixedBuffer(byte: number): ArrayBuffer {
  return new Uint8Array(32).fill(byte).buffer;
}

function stubCredentials(getPrf: ArrayBuffer | null) {
  (globalThis as unknown as { navigator: unknown }).navigator = {
    credentials: {
      create: async () => ({ rawId: fixedBuffer(9) }),
      get: async () => ({
        getClientExtensionResults: () => ({
          prf: getPrf ? { results: { first: getPrf } } : undefined,
        }),
      }),
    },
  };
}

let store: ReturnType<typeof fakeLocalStorage>;

beforeEach(() => {
  store = fakeLocalStorage();
  (globalThis as unknown as { localStorage: unknown }).localStorage = store;
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = {
    isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
  };
});

describe("biometric vault", () => {
  test("enroll + unlock round-trips the passphrase without storing it in the clear", async () => {
    stubCredentials(fixedBuffer(7));
    const ok = await enrollBiometric("0xABC", "codename", "super-secret-passphrase");
    expect(ok).toBe(true);
    expect(biometricEnrolled("0xabc")).toBe(true);

    const raw = store.getItem("ledger:biometric:v1")!;
    expect(raw).not.toContain("super-secret-passphrase");

    const recovered = await unlockWithBiometric("0xabc");
    expect(recovered).toBe("super-secret-passphrase");
  });

  test("a different PRF output fails to decrypt", async () => {
    stubCredentials(fixedBuffer(1));
    await enrollBiometric("0xdef", "codename", "another-passphrase");

    stubCredentials(fixedBuffer(2));
    await expect(unlockWithBiometric("0xdef")).rejects.toThrow(/Face ID/);
  });

  test("enrollBiometric returns false and stores nothing when PRF is unsupported", async () => {
    stubCredentials(null);
    const ok = await enrollBiometric("0xghi", "codename", "yet-another-pass");
    expect(ok).toBe(false);
    expect(biometricEnrolled("0xghi")).toBe(false);
    expect(store.getItem("ledger:biometric:v1")).toBeNull();
  });

  test("disableBiometric clears the record", async () => {
    stubCredentials(fixedBuffer(3));
    await enrollBiometric("0xjkl", "codename", "pass-to-remove");
    expect(biometricEnrolled("0xjkl")).toBe(true);

    disableBiometric("0xjkl");
    expect(biometricEnrolled("0xjkl")).toBe(false);
  });

  test("auto-unlock identity is the enrolled last-session vault, and nothing else", async () => {
    stubCredentials(fixedBuffer(5));
    const addr = "0x1111111111111111111111111111111111111111";
    store.setItem(
      "ledger:identities",
      JSON.stringify([{ address: addr, codename: "c", vault: { any: "blob" }, injected: false }]),
    );

    store.setItem("ledger:session", addr);
    expect(biometricAutoUnlockIdentity()).toBeUndefined(); // not enrolled yet

    await enrollBiometric(addr, "c", "pass");
    expect(biometricAutoUnlockIdentity()?.address).toBe(addr);

    store.removeItem("ledger:session"); // signed out on purpose
    expect(biometricAutoUnlockIdentity()).toBeUndefined();
  });
});
