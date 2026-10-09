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

  test("restores the start page from a backup that carries one", async () => {
    const profileCalls: unknown[] = [];
    await restoreBackupToLedger(
      { ...BASE_PLAIN, settings: { startView: "schedule" } },
      EMPTY_CURRENT,
      {
        ...noopApi(),
        updateProfile: async (s) => {
          profileCalls.push(s);
        },
      },
    );
    expect(profileCalls).toEqual([expect.objectContaining({ startView: "schedule" })]);
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
        startView: undefined,
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

describe("restoreBackupToLedger daily", () => {
  const routine = {
    id: "old-r1",
    title: "Stretch",
    notes: "",
    schedule: [{ from: "2026-10-05", kind: "daily" as const }],
    createdAt: "2026-10-05T08:00:00.000Z",
  };
  const completion = (period: string, done = true) => ({
    id: `old-r1:${period}`,
    routineId: "old-r1",
    period,
    done,
    at: "2026-10-09T08:00:00.000Z",
  });
  const backup: LedgerBackupPlain = {
    ...BASE_PLAIN,
    dailyRoutines: [routine],
    dailyCompletions: [completion("2026-10-05"), completion("2026-10-06")],
  };

  /** A Daily API that records writes and hands out fresh ids like the real server round trip. */
  function dailyApi() {
    const routines: unknown[] = [];
    const completions: { routineId: string; period: string; done: boolean }[] = [];
    return {
      routines,
      completions,
      api: {
        ...noopApi(),
        saveDailyRoutine: async (r: object) => {
          routines.push(r);
          return { ...r, id: `new-r${routines.length}` } as never;
        },
        putDailyCompletion: async (c: { routineId: string; period: string; done: boolean }) => {
          completions.push(c);
        },
      },
    };
  }

  test("recreates routines and attaches each completion to its new routine, keeping its period", async () => {
    const { api, routines, completions } = dailyApi();

    const result = await restoreBackupToLedger(backup, EMPTY_CURRENT, api);

    expect(routines).toHaveLength(1);
    expect(routines[0]).not.toHaveProperty("id");
    expect(completions.map((c) => [c.routineId, c.period])).toEqual([
      ["new-r1", "2026-10-05"],
      ["new-r1", "2026-10-06"],
    ]);
    expect(result).toMatchObject({ dailyRoutines: 1, dailyCompletions: 2, failed: 0 });
  });

  test("restoring the same backup again adds no routines and no completions", async () => {
    const { api, routines, completions } = dailyApi();
    const restored = {
      ...EMPTY_CURRENT,
      dailyRoutines: [{ ...routine, id: "new-r1" }],
      dailyCompletions: [
        { ...completion("2026-10-05"), id: "new-r1:2026-10-05", routineId: "new-r1" },
        { ...completion("2026-10-06"), id: "new-r1:2026-10-06", routineId: "new-r1" },
      ],
    };

    const result = await restoreBackupToLedger(backup, restored, api);

    expect(routines).toHaveLength(0);
    expect(completions).toHaveLength(0);
    expect(result).toMatchObject({ dailyRoutines: 0, dailyCompletions: 0, failed: 0 });
  });

  test("a completion whose routine is missing from the backup is counted as failed, not written", async () => {
    const { api, completions } = dailyApi();

    const result = await restoreBackupToLedger(
      { ...BASE_PLAIN, dailyCompletions: [completion("2026-10-05")] },
      EMPTY_CURRENT,
      api,
    );

    expect(completions).toHaveLength(0);
    expect(result.failed).toBe(1);
  });

  test("a backup from before Daily existed restores without touching it", async () => {
    const { api, routines, completions } = dailyApi();

    const result = await restoreBackupToLedger(BASE_PLAIN, EMPTY_CURRENT, api);

    expect(routines).toHaveLength(0);
    expect(completions).toHaveLength(0);
    expect(result).toMatchObject({ dailyRoutines: 0, dailyCompletions: 0 });
  });
});
