import { describe, expect, test } from "bun:test";
import {
  buildBackupPlain,
  decryptBackup,
  encryptBackup,
  parseBackupFile,
} from "@/frontend/auth/lib/encrypted-backup";
import { buildDerivationMessage, deriveKeyFromSignature } from "@/frontend/lib/crypto/e2ee";
import { Wallet } from "ethers";

async function testKey() {
  const wallet = Wallet.createRandom();
  const sig = await wallet.signMessage(buildDerivationMessage(wallet.address));
  return { key: await deriveKeyFromSignature(sig), address: wallet.address };
}

describe("encrypted backup", () => {
  test("encrypt / decrypt round-trip includes capitals and vehicles", async () => {
    const { key, address } = await testKey();
    const plain = buildBackupPlain({
      address,
      wallets: [],
      categories: [],
      expenses: [],
      events: [],
      todoLists: [],
      capitalPlans: [
        {
          id: "cccccccccccccccccccccccc",
          name: "Trip",
          glyph: "🏖️",
          createdAt: "2026-01-01T00:00:00.000Z",
          items: [],
        },
      ],
      vehicles: [
        {
          id: "dddddddddddddddddddddddd",
          name: "Civic",
          model: "FK8",
          type: "car",
          glyph: "🚗",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      vehicleFills: [
        {
          id: "eeeeeeeeeeeeeeeeeeeeeeee",
          vehicleId: "dddddddddddddddddddddddd",
          date: "2026-07-01",
          price: 80,
          quantity: 40,
          station: "Shell",
          partial: false,
        },
      ],
    });
    const restored = await decryptBackup(key, await encryptBackup(key, plain));
    expect(restored.capitalPlans).toEqual(plain.capitalPlans);
    expect(restored.vehicles).toEqual(plain.vehicles);
    expect(restored.vehicleFills).toEqual(plain.vehicleFills);
  });

  test("encrypt / decrypt round-trip", async () => {
    const { key, address } = await testKey();
    const plain = buildBackupPlain({
      address,
      wallets: [],
      categories: [],
      expenses: [
        {
          id: "aaaaaaaaaaaaaaaaaaaaaaaa",
          walletId: "bbbbbbbbbbbbbbbbbbbbbbbb",
          kind: "expense",
          date: "2026-07-01",
          sub: "food",
          amount: 12.5,
          note: "lunch",
          recurring: false,
        },
      ],
      events: [],
      todoLists: [],
    });
    const file = await encryptBackup(key, plain);
    expect(file.format).toBe("custos-backup");
    const restored = await decryptBackup(key, file);
    expect(restored.expenses).toEqual(plain.expenses);
    expect(restored.address).toBe(address);
  });

  test("encrypt / decrypt round-trip includes settings", async () => {
    const { key, address } = await testKey();
    const plain = buildBackupPlain({
      address,
      wallets: [],
      categories: [],
      expenses: [],
      events: [],
      todoLists: [],
      settings: {
        codename: "Maple Owl",
        notifyEmail: "you@mail.com",
        timezone: "Asia/Kuala_Lumpur",
        emailRemindersEnabled: true,
        budgetAlertsEnabled: false,
        tourPreference: "guided",
        toursSeen: ["shell"],
        accent: "moss",
        navTabs: ["overview", "budgets"],
        navOrder: ["overview", "budgets", "insights"],
        consentOptedIn: false,
      },
    });
    const restored = await decryptBackup(key, await encryptBackup(key, plain));
    expect(restored.settings).toEqual(plain.settings);
  });

  test("buildBackupPlain omits settings when not given", async () => {
    const { address } = await testKey();
    const plain = buildBackupPlain({
      address,
      wallets: [],
      categories: [],
      expenses: [],
      events: [],
      todoLists: [],
    });
    expect(plain.settings).toBeUndefined();
  });

  test("parseBackupFile accepts legacy format id", () => {
    const raw = JSON.stringify({
      format: "sched-ledger-backup",
      version: 1,
      address: "0xabc",
      exportedAt: "2026-01-01T00:00:00.000Z",
      payload: "x",
    });
    expect(parseBackupFile(raw).format).toBe("sched-ledger-backup");
  });

  test("parseBackupFile rejects garbage", () => {
    expect(() => parseBackupFile("{not json")).toThrow();
    expect(() => parseBackupFile(JSON.stringify({ format: "other" }))).toThrow(/Not a Custos/);
  });
});
