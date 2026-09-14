import { describe, expect, test } from "bun:test";
import {
  buildDerivationMessage,
  decryptJson,
  deriveKeyFromSignature,
  deriveSeriesHmacKeyFromSignature,
  encryptJson,
  expenseSeriesKey,
  DERIVATION_MESSAGE_PREFIX,
} from "@/frontend/lib/crypto/e2ee";
import { getAddress, Wallet, type HDNodeWallet } from "ethers";
import { E2EE_VERSION } from "@/schemas/encryption";

async function keyFromWallet(wallet: HDNodeWallet) {
  const message = buildDerivationMessage(wallet.address);
  const signature = await wallet.signMessage(message);
  return deriveKeyFromSignature(signature);
}

async function seriesKeyFromWallet(wallet: HDNodeWallet) {
  const message = buildDerivationMessage(wallet.address);
  const signature = await wallet.signMessage(message);
  return deriveSeriesHmacKeyFromSignature(signature);
}

describe("e2ee primitives", () => {
  test("buildDerivationMessage checksums the address", () => {
    const lower = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const msg = buildDerivationMessage(lower);
    expect(msg.startsWith(DERIVATION_MESSAGE_PREFIX)).toBe(true);
    expect(msg).toContain(getAddress(lower));
  });

  test("encryptJson / decryptJson round-trip", async () => {
    const wallet = Wallet.createRandom();
    const key = await keyFromWallet(wallet);
    const payload = { sub: "groceries", amount: 42.5, note: "milk" };
    const cipher = await encryptJson(key, payload);
    const plain = await decryptJson<typeof payload>(key, cipher);
    expect(plain).toEqual(payload);
  });

  test("wrong key fails decrypt", async () => {
    const a = await keyFromWallet(Wallet.createRandom());
    const b = await keyFromWallet(Wallet.createRandom());
    const cipher = await encryptJson(a, { amount: 1 });
    await expect(decryptJson(b, cipher)).rejects.toThrow();
  });

  test("unsupported version fails", async () => {
    const key = await keyFromWallet(Wallet.createRandom());
    const cipher = await encryptJson(key, { ok: true });
    const packed = Uint8Array.from(atob(cipher), (c) => c.charCodeAt(0));
    packed[0] = E2EE_VERSION + 1;
    let binary = "";
    for (const b of packed) binary += String.fromCharCode(b);
    const tampered = btoa(binary);
    await expect(decryptJson(key, tampered)).rejects.toThrow(/Unsupported encryption format/);
  });

  test("ciphertext tampering fails authentication", async () => {
    const key = await keyFromWallet(Wallet.createRandom());
    const cipher = await encryptJson(key, { amount: 9 });
    const packed = Uint8Array.from(atob(cipher), (c) => c.charCodeAt(0));
    packed[packed.length - 1]! ^= 0xff;
    let binary = "";
    for (const b of packed) binary += String.fromCharCode(b);
    await expect(decryptJson(key, btoa(binary))).rejects.toThrow();
  });

  test("each encryption uses a unique IV (different ciphertext)", async () => {
    const key = await keyFromWallet(Wallet.createRandom());
    const a = await encryptJson(key, { x: 1 });
    const b = await encryptJson(key, { x: 1 });
    expect(a).not.toBe(b);
  });

  test("same wallet signature derives a usable key", async () => {
    const wallet = Wallet.createRandom();
    const message = buildDerivationMessage(wallet.address);
    const sig = await wallet.signMessage(message);
    const key1 = await deriveKeyFromSignature(sig);
    const key2 = await deriveKeyFromSignature(sig);
    const cipher = await encryptJson(key1, { hello: "world" });
    await expect(decryptJson(key2, cipher)).resolves.toEqual({ hello: "world" });
  });

  test("expenseSeriesKey is stable for identical inputs", async () => {
    const seriesKey = await seriesKeyFromWallet(Wallet.createRandom());
    const fields = {
      walletId: "abc123",
      sub: "groceries",
      note: "weekly",
      recurring: "monthly" as const,
    };
    const a = await expenseSeriesKey(seriesKey, fields);
    const b = await expenseSeriesKey(seriesKey, fields);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  test("expenseSeriesKey changes when note changes", async () => {
    const seriesKey = await seriesKeyFromWallet(Wallet.createRandom());
    const base = {
      walletId: "abc123",
      sub: "groceries",
      note: "weekly",
      recurring: "monthly" as const,
    };
    const a = await expenseSeriesKey(seriesKey, base);
    const b = await expenseSeriesKey(seriesKey, { ...base, note: "monthly shop" });
    expect(a).not.toBe(b);
  });

  test("expenseSeriesKey is not reproducible without the account's series key", async () => {
    const fields = {
      walletId: "abc123",
      sub: "groceries",
      note: "weekly",
      recurring: "monthly" as const,
    };
    const keyA = await seriesKeyFromWallet(Wallet.createRandom());
    const keyB = await seriesKeyFromWallet(Wallet.createRandom());
    const a = await expenseSeriesKey(keyA, fields);
    const b = await expenseSeriesKey(keyB, fields);
    /* Identical plaintext fields under two different account keys must not
       collide — unlike the retired plain-SHA-256 construction, which anyone
       who knew walletId/sub/recurring (all server-visible or enumerable)
       could reproduce offline to confirm or dictionary-attack the note. */
    expect(a).not.toBe(b);
  });
});
