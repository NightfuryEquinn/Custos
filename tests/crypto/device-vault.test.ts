import { describe, expect, test } from "bun:test";
import {
  checkQuizAnswers,
  isValidPassphrase,
  needsRewrap,
  pickQuizIndices,
  unwrapSecrets,
  wrapSecrets,
} from "@/frontend/auth/lib/device-vault";

describe("device vault", () => {
  test("wrapSecrets / unwrapSecrets round-trip", async () => {
    const secrets = {
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      privateKey: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    const vault = await wrapSecrets("correct horse battery", secrets);
    /* Always writes at the current version (600k PBKDF2 iterations) — see
       "an existing v1 vault still unlocks" below for the older format. */
    expect(vault.v).toBe(2);
    expect(needsRewrap(vault)).toBe(false);
    expect(vault.salt.length).toBeGreaterThan(8);
    const plain = await unwrapSecrets("correct horse battery", vault);
    expect(plain).toEqual(secrets);
  });

  test("an existing v1 vault (310k iterations) still unlocks and is flagged for rewrap", async () => {
    const secrets = {
      mnemonic: "one two three four five six seven eight nine ten eleven twelve",
      privateKey: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    };
    /* Hand-built at the old version/iteration count — wrapSecrets always
       writes v2 now, so this reproduces a vault created before the bump. */
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("correct horse battery"),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 310_000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(secrets)),
    );
    const bytesToBase64 = (bytes: Uint8Array) => {
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    };
    const v1Vault = {
      v: 1,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };

    expect(needsRewrap(v1Vault)).toBe(true);
    const plain = await unwrapSecrets("correct horse battery", v1Vault);
    expect(plain).toEqual(secrets);

    /* Silent re-wrap (as UnlockScreen's materializeIdentity does) produces a
       current-version vault that decrypts to the same secrets. */
    const rewrapped = await wrapSecrets("correct horse battery", plain);
    expect(needsRewrap(rewrapped)).toBe(false);
    await expect(unwrapSecrets("correct horse battery", rewrapped)).resolves.toEqual(secrets);
  });

  test("wrong passphrase fails", async () => {
    const vault = await wrapSecrets("long-enough-pass", {
      mnemonic: "one two three four five six seven eight nine ten eleven twelve",
      privateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    await expect(unwrapSecrets("wrong-passphrase", vault)).rejects.toThrow(/Wrong passphrase/);
  });

  test("isValidPassphrase enforces length", () => {
    expect(isValidPassphrase("short")).toBe(false);
    expect(isValidPassphrase("12345678")).toBe(true);
  });

  test("pickQuizIndices returns sorted unique indices", () => {
    const indices = pickQuizIndices(12, 3);
    expect(indices).toHaveLength(3);
    expect(new Set(indices).size).toBe(3);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
    expect(indices.every((i) => i >= 0 && i < 12)).toBe(true);
  });

  test("checkQuizAnswers is case-insensitive", () => {
    const words = ["alpha", "bravo", "charlie", "delta"];
    expect(checkQuizAnswers(words, [0, 2], { 0: "Alpha", 2: "CHARLIE" })).toBe(true);
    expect(checkQuizAnswers(words, [0, 2], { 0: "alpha", 2: "wrong" })).toBe(false);
  });
});
