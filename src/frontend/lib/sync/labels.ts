import { decryptJson, encryptJson } from "@/frontend/lib/crypto/e2ee";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import type { EntityKind, OutboxEntry } from "./types";

/**
 * Outbox labels are stored as plain text in IndexedDB, so `label` is a fixed word about
 * the kind of change, never anything the user typed (a title, a note, a name). The name
 * the sync banner shows ("Coffee", "Take medication") is kept separately as `labelEnc`,
 * encrypted with the ledger key: readable only while the ledger is unlocked.
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

const MAX_NAME = 80;

/** Encrypt a name for the sync banner. Nothing is stored when there is no name or the ledger is locked. */
export async function sealLabel(address: string, text?: string | null) {
  const name = text?.trim().slice(0, MAX_NAME);
  const key = ledgerKeyStore.get(address);

  return name && key ? sealWith(key, name) : undefined;
}

/** Same, with a key already in hand (the scrub of entries queued by older versions). */
export const sealWith = (key: CryptoKey, name: string) =>
  encryptJson(key, { t: name.trim().slice(0, MAX_NAME) });

/** The name to show for a queued write: the decrypted one when possible, else the fixed word. */
export async function openLabel(
  entry: Pick<OutboxEntry, "entity" | "label" | "labelEnc">,
  key: CryptoKey | null,
): Promise<string> {
  const fixed = entry.label || genericLabel(entry.entity);
  if (!entry.labelEnc || !key) return fixed;
  try {
    return (await decryptJson<{ t: string }>(key, entry.labelEnc)).t || fixed;
  } catch {
    return fixed; // wrong key (for example after a key change): fall back, never fail the banner
  }
}
