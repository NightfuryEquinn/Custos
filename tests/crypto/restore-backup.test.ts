import { describe, expect, test } from "bun:test";
import { restoreBackupToLedger } from "@/frontend/auth/lib/restore-backup";
import type { LedgerBackupPlain } from "@/frontend/auth/lib/encrypted-backup";

const ADDRESS = "0xabc";

const EMPTY_CURRENT = {
  address: ADDRESS,
  wallets: [],
  expenses: [],
  events: [],
  todoLists: [],
  capitalPlans: [],
  vehicles: [],
  vehicleFills: [],
};

const BASE_PLAIN: LedgerBackupPlain = {
  format: "custos-backup",
  version: 1,
  exportedAt: "2026-01-01T00:00:00.000Z",
  address: ADDRESS,
  wallets: [],
  categories: [],
  expenses: [],
  events: [],
  todoLists: [],
};

function noopApi() {
  return {
    saveCategories: async () => undefined,
    saveWallet: async (w: { id?: string }) => ({ ...w, id: w.id ?? "w1" }) as never,
    saveExpense: async () => undefined,
    saveEvent: async () => undefined,
    saveTodoList: async () => undefined,
    saveCapitalPlan: async () => undefined,
    saveVehicle: async (v: { id?: string }) => ({ ...v, id: v.id ?? "v1" }) as never,
    saveVehicleFill: async () => undefined,
  };
}

describe("restoreBackupToLedger settings", () => {
  test("skips settings restore when the backup has none", async () => {
    let called = false;
    const result = await restoreBackupToLedger(BASE_PLAIN, EMPTY_CURRENT, {
      ...noopApi(),
      updateUser: async () => {
        called = true;
      },
    });
    expect(called).toBe(false);
    expect(result.settings).toBe(false);
  });

  test("applies user, profile, and consent settings when present", async () => {
    const userCalls: unknown[] = [];
    const profileCalls: unknown[] = [];
    const consentCalls: boolean[] = [];
    const result = await restoreBackupToLedger(
      {
        ...BASE_PLAIN,
        settings: {
          notifyEmail: "you@mail.com",
          accent: "moss",
          consentOptedIn: false,
        },
      },
      EMPTY_CURRENT,
      {
        ...noopApi(),
        updateUser: async (s) => {
          userCalls.push(s);
        },
        updateProfile: async (s) => {
          profileCalls.push(s);
        },
        updateConsent: async (optedIn) => {
          consentCalls.push(optedIn);
        },
      },
    );
    expect(result.settings).toBe(true);
    expect(userCalls).toEqual([
      {
        codename: undefined,
        notifyEmail: "you@mail.com",
        timezone: undefined,
        emailRemindersEnabled: undefined,
        budgetAlertsEnabled: undefined,
      },
    ]);
    expect(profileCalls).toEqual([
      {
        tourPreference: undefined,
        toursSeen: undefined,
        accent: "moss",
        navTabs: undefined,
        navOrder: undefined,
      },
    ]);
    expect(consentCalls).toEqual([false]);
  });

  test("rejects a backup from a different address", async () => {
    await expect(
      restoreBackupToLedger(
        { ...BASE_PLAIN, address: "0xother" },
        EMPTY_CURRENT,
        noopApi() as never,
      ),
    ).rejects.toThrow(/different wallet address/);
  });
});
