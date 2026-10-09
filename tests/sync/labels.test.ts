import { expect, test } from "bun:test";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { openLabel, sealLabel } from "@/frontend/lib/sync/labels";

const address = "0xabc0000000000000000000000000000000000004";
const aesKey = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

test("the readable name is stored encrypted and comes back for display", async () => {
  const key = await aesKey();
  ledgerKeyStore.set(address, key);
  try {
    const sealed = await sealLabel(address, "Take medication");

    expect(sealed).toBeDefined();
    expect(sealed).not.toContain("Take medication");
    expect(
      await openLabel({ entity: "dailyRoutine", label: "Routine", labelEnc: sealed }, key),
    ).toBe("Take medication");
  } finally {
    ledgerKeyStore.clear(address);
  }
});

test("nothing to seal, or no key, stores nothing", async () => {
  ledgerKeyStore.clear(address);
  expect(await sealLabel(address, "Groceries")).toBeUndefined(); // locked
  ledgerKeyStore.set(address, await aesKey());
  try {
    expect(await sealLabel(address, "   ")).toBeUndefined();
    expect(await sealLabel(address, undefined)).toBeUndefined();
  } finally {
    ledgerKeyStore.clear(address);
  }
});

test("while locked, or with the wrong key, the fixed word is shown instead", async () => {
  const key = await aesKey();
  ledgerKeyStore.set(address, key);
  const sealed = await sealLabel(address, "Groceries");
  ledgerKeyStore.clear(address);

  const entry = { entity: "todoList" as const, label: "List", labelEnc: sealed };
  expect(await openLabel(entry, null)).toBe("List");
  expect(await openLabel(entry, await aesKey())).toBe("List");
});

test("a very long name is shortened", async () => {
  const key = await aesKey();
  ledgerKeyStore.set(address, key);
  try {
    const sealed = await sealLabel(address, "x".repeat(500));
    const shown = await openLabel({ entity: "event", label: "Event", labelEnc: sealed }, key);
    expect(shown.length).toBeLessThanOrEqual(80);
  } finally {
    ledgerKeyStore.clear(address);
  }
});
