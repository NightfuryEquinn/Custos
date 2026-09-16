/**
 * Apply a decrypted backup into the live ledger via existing save APIs.
 * Client-only; remaps wallets by name+currency when ids differ.
 */

import type {
  CapitalPlan,
  Category,
  Expense,
  FinancialWallet,
  FuelFill,
  LedgerEvent,
  TodoList,
  Vehicle,
} from "@/frontend/lib/types";
import type { BackupSettings, LedgerBackupPlain } from "./encrypted-backup";

type BackupRestoreApi = {
  saveCategories: (categories: Category[]) => Promise<unknown>;
  saveWallet: (wallet: Omit<FinancialWallet, "id"> & { id?: string }) => Promise<FinancialWallet>;
  saveExpense: (expense: Omit<Expense, "id"> & { id?: string }) => Promise<unknown>;
  saveEvent: (event: Omit<LedgerEvent, "id"> & { id?: string }) => Promise<unknown>;
  saveTodoList: (list: Omit<TodoList, "id"> & { id?: string }) => Promise<unknown>;
  saveCapitalPlan: (plan: Omit<CapitalPlan, "id"> & { id?: string }) => Promise<unknown>;
  saveVehicle: (vehicle: Omit<Vehicle, "id"> & { id?: string }) => Promise<Vehicle>;
  saveVehicleFill: (fill: Omit<FuelFill, "id"> & { id?: string }) => Promise<unknown>;
  /** Account preferences — codename, notify email, timezone, reminder toggles. */
  updateUser?: (settings: BackupSettings) => Promise<unknown>;
  /** Profile preferences — tour state, accent, nav layout. */
  updateProfile?: (settings: BackupSettings) => Promise<unknown>;
  /** Data-sharing opt-in preference. */
  updateConsent?: (optedIn: boolean) => Promise<unknown>;
};

export type BackupRestoreResult = {
  wallets: number;
  categories: boolean;
  expenses: number;
  events: number;
  todos: number;
  capitalPlans: number;
  vehicles: number;
  vehicleFills: number;
  settings: boolean;
  failed: number;
};

/** Restore backup rows into the unlocked ledger (batched sequential writes). */
export async function restoreBackupToLedger(
  plain: LedgerBackupPlain,
  current: {
    address: string;
    wallets: FinancialWallet[];
    expenses: Expense[];
    events: LedgerEvent[];
    todoLists: TodoList[];
    capitalPlans: CapitalPlan[];
    vehicles: Vehicle[];
    vehicleFills: FuelFill[];
  },
  api: BackupRestoreApi,
): Promise<BackupRestoreResult> {
  if (plain.address.toLowerCase() !== current.address.toLowerCase()) {
    throw new Error("Backup belongs to a different wallet address.");
  }

  const result: BackupRestoreResult = {
    wallets: 0,
    categories: false,
    expenses: 0,
    events: 0,
    todos: 0,
    capitalPlans: 0,
    vehicles: 0,
    vehicleFills: 0,
    settings: false,
    failed: 0,
  };

  if (plain.categories?.length) {
    await api.saveCategories(plain.categories);
    result.categories = true;
  }

  const walletIdMap = new Map<string, string>();
  for (const w of current.wallets) {
    walletIdMap.set(w.id, w.id);
  }

  for (const bw of plain.wallets ?? []) {
    const match = current.wallets.find(
      (w) => w.name.toLowerCase() === bw.name.toLowerCase() && w.currency === bw.currency,
    );
    if (match) {
      walletIdMap.set(bw.id, match.id);
      continue;
    }
    try {
      const { id: _ignore, ...rest } = bw;
      const created = await api.saveWallet({ ...rest, isDefault: false });
      walletIdMap.set(bw.id, created.id);
      result.wallets++;
    } catch {
      result.failed++;
    }
  }

  const defaultWalletId = current.wallets.find((w) => w.isDefault)?.id ?? current.wallets[0]?.id;

  const existingExpenseIds = new Set(current.expenses.map((e) => e.id));
  for (const row of plain.expenses ?? []) {
    if (existingExpenseIds.has(row.id)) continue;
    const walletId = walletIdMap.get(row.walletId) ?? defaultWalletId;
    if (!walletId) {
      result.failed++;
      continue;
    }
    try {
      const { id: _id, ...rest } = row;
      await api.saveExpense({ ...rest, walletId });
      result.expenses++;
    } catch {
      result.failed++;
    }
  }

  const existingEventIds = new Set(current.events.map((e) => e.id));
  for (const row of plain.events ?? []) {
    if (existingEventIds.has(row.id)) continue;
    try {
      const { id: _id, ...rest } = row;
      await api.saveEvent(rest);
      result.events++;
    } catch {
      result.failed++;
    }
  }

  const existingTodoIds = new Set(current.todoLists.map((t) => t.id));
  for (const row of plain.todoLists ?? []) {
    if (existingTodoIds.has(row.id)) continue;
    try {
      const { id: _id, ...rest } = row;
      await api.saveTodoList(rest);
      result.todos++;
    } catch {
      result.failed++;
    }
  }

  const existingPlanIds = new Set(current.capitalPlans.map((p) => p.id));
  for (const row of plain.capitalPlans ?? []) {
    if (existingPlanIds.has(row.id)) continue;
    try {
      const { id: _id, ...rest } = row;
      await api.saveCapitalPlan(rest);
      result.capitalPlans++;
    } catch {
      result.failed++;
    }
  }

  const vehicleIdMap = new Map<string, string>();
  for (const v of current.vehicles) {
    vehicleIdMap.set(v.id, v.id);
  }

  const existingVehicleIds = new Set(current.vehicles.map((v) => v.id));
  for (const row of plain.vehicles ?? []) {
    if (existingVehicleIds.has(row.id)) {
      vehicleIdMap.set(row.id, row.id);
      continue;
    }
    try {
      const { id: _id, ...rest } = row;
      const created = await api.saveVehicle(rest);
      vehicleIdMap.set(row.id, created.id);
      result.vehicles++;
    } catch {
      result.failed++;
    }
  }

  const existingFillIds = new Set(current.vehicleFills.map((f) => f.id));
  for (const row of plain.vehicleFills ?? []) {
    if (existingFillIds.has(row.id)) continue;
    const vehicleId = vehicleIdMap.get(row.vehicleId);
    if (!vehicleId) {
      result.failed++;
      continue;
    }
    try {
      const { id: _id, ...rest } = row;
      await api.saveVehicleFill({ ...rest, vehicleId });
      result.vehicleFills++;
    } catch {
      result.failed++;
    }
  }

  if (plain.settings) {
    try {
      await restoreSettings(plain.settings, api);
      result.settings = true;
    } catch {
      result.failed++;
    }
  }

  return result;
}

/** Apply the backup's account/profile preferences via the update APIs. */
async function restoreSettings(settings: BackupSettings, api: BackupRestoreApi): Promise<void> {
  const { codename, notifyEmail, timezone, emailRemindersEnabled, budgetAlertsEnabled } = settings;
  const userPatch = { codename, notifyEmail, timezone, emailRemindersEnabled, budgetAlertsEnabled };
  if (api.updateUser && Object.values(userPatch).some((v) => v !== undefined)) {
    await api.updateUser(userPatch);
  }

  const { tourPreference, toursSeen, accent, navTabs, navOrder } = settings;
  const profilePatch = { tourPreference, toursSeen, accent, navTabs, navOrder };
  if (api.updateProfile && Object.values(profilePatch).some((v) => v !== undefined)) {
    await api.updateProfile(profilePatch);
  }

  if (api.updateConsent && settings.consentOptedIn !== undefined) {
    await api.updateConsent(settings.consentOptedIn);
  }
}
