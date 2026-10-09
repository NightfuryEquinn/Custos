import type { EntityKind } from "./types";

/**
 * Outbox labels are stored as plain text in IndexedDB, so they are fixed words about
 * the kind of change, never anything the user typed (a title, a note, a name).
 */
const ENTITY_LABEL: Record<EntityKind, string> = {
  expense: "Expense",
  wallet: "Wallet",
  walletBudgets: "Budgets",
  categories: "Categories",
  event: "Event",
  todoList: "List",
  capitalPlan: "Capital plan",
  vehicle: "Vehicle",
  vehicleFill: "Fill-up",
  dailyRoutine: "Routine",
  dailyCompletion: "Routine check-in",
  profile: "Profile",
};

/** Every label the app writes. Anything else found at rest is treated as old, readable text. */
const FIXED_LABELS = new Set<string>([
  ...Object.values(ENTITY_LABEL),
  "Selected month",
  "Delete expense",
  "Delete event",
  "Delete list",
  "Delete vehicle",
  "Delete fill",
]);

export const genericLabel = (entity: EntityKind) => ENTITY_LABEL[entity];
export const isFixedLabel = (label: string) => FIXED_LABELS.has(label);
