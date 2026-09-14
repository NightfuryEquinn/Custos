import { describe, expect, test } from "bun:test";
import {
  buildDerivationMessage,
  DERIVATION_MESSAGE_PREFIX,
  isValidAuthChallenge,
  LEGACY_DERIVATION_MESSAGE_PREFIX,
} from "@/frontend/lib/crypto/e2ee";
import { buildAuthMessage, generateNonce } from "@/api/lib/auth";
import { getAddress } from "ethers";

describe("derivation message", () => {
  test("defaults to Custos prefix", () => {
    const address = "0x0000000000000000000000000000000000000001";
    const message = buildDerivationMessage(address);

    expect(message.startsWith(DERIVATION_MESSAGE_PREFIX)).toBe(true);
    expect(message).toContain(getAddress(address));
    expect(message).not.toContain("Sched Ledger");
  });

  test("can build the legacy Sched Ledger message", () => {
    const address = "0x0000000000000000000000000000000000000001";
    const message = buildDerivationMessage(address, LEGACY_DERIVATION_MESSAGE_PREFIX);

    expect(message.startsWith(LEGACY_DERIVATION_MESSAGE_PREFIX)).toBe(true);
    expect(message).toContain("Sched Ledger");
  });
});

describe("isValidAuthChallenge", () => {
  const address = "0x0000000000000000000000000000000000000001";

  test("accepts a real server-built challenge for the matching address", () => {
    const message = buildAuthMessage(address, generateNonce(), "https://custos.example");
    expect(isValidAuthChallenge(message, address)).toBe(true);
  });

  test("rejects the current-generation derivation message", () => {
    const message = buildDerivationMessage(address);
    expect(isValidAuthChallenge(message, address)).toBe(false);
  });

  test("rejects the legacy derivation message", () => {
    const message = buildDerivationMessage(address, LEGACY_DERIVATION_MESSAGE_PREFIX);
    expect(isValidAuthChallenge(message, address)).toBe(false);
  });

  test("rejects a challenge for a different address", () => {
    const other = "0x0000000000000000000000000000000000000002";
    const message = buildAuthMessage(other, generateNonce(), "https://custos.example");
    expect(isValidAuthChallenge(message, address)).toBe(false);
  });

  test("rejects a challenge smuggling the derivation prefix in an extra line", () => {
    const message = `${buildAuthMessage(address, generateNonce(), "https://custos.example")}\n${DERIVATION_MESSAGE_PREFIX}`;
    expect(isValidAuthChallenge(message, address)).toBe(false);
  });

  test("rejects malformed or truncated challenges", () => {
    expect(isValidAuthChallenge("", address)).toBe(false);
    expect(
      isValidAuthChallenge("Custos wants you to sign in with your Web3 identity.", address),
    ).toBe(false);
    expect(
      isValidAuthChallenge(`not the right preamble\n\nAddress: ${getAddress(address)}`, address),
    ).toBe(false);
  });
});
