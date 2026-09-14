/**
 * Rebuilds what the ledger looks like with pending outbox entries applied,
 * by decoding each entry's own (already-encrypted) request body through the
 * existing codec functions — the same `decodeExpense`/`decodeEvent`/etc. a
 * real server response goes through. No separate plaintext copy is stored
 * anywhere: the outbox holds ciphertext, and the overlay decrypts it at read
 * time with whatever key is currently unlocked.
 *
 * This is the mechanism that makes "close the app while offline, reopen it"
 * work — it's rebuilt from the durable outbox on every call, not from an
 * in-memory optimistic patch that dies on reload.
 *
 * `applyOverlay` is entity-agnostic; the per-entity knowledge (how to decode
 * a wire, and how to reconstruct one from an already-decoded row for a
 * partial-patch update) lives in the `OverlaySpec` objects below, one per
 * list-shaped entity. Categories/wallet budgets are singleton documents, not
 * lists — see `applySingletonOverlay`.
 */

import {
  decodeCapitalPlan,
  decodeEvent,
  decodeExpense,
  decodeTodoList,
  decodeVehicle,
  decodeVehicleFill,
  decodeWallet,
  type CapitalPlanWire,
  type EventWire,
  type ExpenseWire,
  type TodoListWire,
  type VehicleFillWire,
  type VehicleWire,
  type WalletWire,
} from "@/frontend/lib/crypto/codec";
import type {
  CapitalPlan,
  Expense,
  FinancialWallet,
  FuelFill,
  LedgerEvent,
  TodoList,
  Vehicle,
} from "@/frontend/lib/types";
import type { EntityKind, OutboxEntry } from "./types";

/** Merge a patch's *present* keys onto a base wire; absent keys are untouched. */
function mergeWire<W extends { id: string }>(base: W, patch: Record<string, unknown>): W {
  return { ...base, ...patch };
}

/**
 * Name-only summary of a decode failure, never the error itself. The
 * documented failure mode (a key mismatch mid-rekey) throws a WebCrypto
 * `OperationError` with no plaintext in its message — but if a GCM tag ever
 * verified against a payload that then failed `JSON.parse`, a V8/JSC
 * `SyntaxError` embeds a slice of the *decrypted* text it choked on. Not
 * reachable in the documented failure mode, but logging only the error's
 * name costs nothing and closes that path off entirely.
 */
function safeErrorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** How to render one list-shaped entity's pending outbox entries. */
type OverlaySpec<T extends { id: string }, W extends { id: string }> = {
  entity: EntityKind;
  decode: (wire: W, key: CryptoKey) => Promise<T>;
  /** The skeleton a "create" starts from, before the request body is merged on. */
  emptyWire: (id: string) => W;
  /** Reconstruct a base wire from an already-decoded row, for merging a partial update onto it. */
  wireFrom: (id: string, existing: T) => W;
};

/**
 * Layer pending creates/updates/deletes for one entity over server-derived
 * rows. Entries apply in `seq` order so a create-then-edit composes
 * correctly. A "delete" entry normally removes the row; when it carries an
 * `overlayPatch` instead (a scoped event delete that only trims the
 * schedule, say), that patch is applied to the row in place of removing it.
 */
export async function applyOverlay<T extends { id: string }, W extends { id: string }>(
  base: T[],
  entries: OutboxEntry[],
  key: CryptoKey,
  spec: OverlaySpec<T, W>,
): Promise<T[]> {
  const relevant = entries.filter((e) => e.entity === spec.entity).sort((a, b) => a.seq - b.seq);
  if (!relevant.length) return base;

  let result = base;
  const wireById = new Map<string, W>();

  for (const entry of relevant) {
    if (entry.op === "delete") {
      if (entry.overlayPatch) {
        result = result.map((item) =>
          item.id === entry.targetId ? { ...item, ...entry.overlayPatch } : item,
        );
      } else {
        result = result.filter((item) => item.id !== entry.targetId);
      }
      wireById.delete(entry.targetId);
      continue;
    }

    const patch = (entry.request.body ?? {}) as Record<string, unknown>;
    const existingWire = wireById.get(entry.targetId);
    const baseWire: W =
      entry.op === "create"
        ? spec.emptyWire(entry.targetId)
        : (existingWire ??
          (() => {
            const existingItem = result.find((item) => item.id === entry.targetId);
            return existingItem
              ? spec.wireFrom(entry.targetId, existingItem)
              : spec.emptyWire(entry.targetId);
          })());
    /* `overlayPatch` layers locally-known truth the request body doesn't
       carry (e.g. a client-minted `createdAt` a create endpoint's response
       would normally supply) on top of the request patch. */
    const wire = mergeWire(baseWire, { ...patch, ...entry.overlayPatch, id: entry.targetId });
    wireById.set(entry.targetId, wire);

    try {
      const decoded = await spec.decode(wire, key);
      if (entry.op === "create") {
        result = result.some((item) => item.id === decoded.id)
          ? result.map((item) => (item.id === decoded.id ? decoded : item))
          : [decoded, ...result];
      } else {
        result = result.map((item) => (item.id === entry.targetId ? decoded : item));
      }
    } catch (err) {
      /* A decode failure here (e.g. a key mismatch mid-rekey) means this one
         entry's optimistic row can't render — surfaced for diagnosis, not
         thrown, so the rest of the overlay (and the underlying server data)
         still renders. The entry itself is untouched and still drains normally. */
      console.error(
        `[sync] overlay decode failed for ${spec.entity}:${entry.targetId}`,
        safeErrorName(err),
      );
    }
  }

  return result;
}

export const expenseOverlay: OverlaySpec<Expense, ExpenseWire> = {
  entity: "expense",
  decode: decodeExpense,
  emptyWire: (id) => ({ id, walletId: "", kind: "expense", date: "", recurring: false }),
  wireFrom: (id, existing) => ({
    id,
    walletId: existing.walletId,
    kind: existing.kind,
    date: existing.date,
    recurring: existing.recurring,
    eventId: existing.eventId,
    capitalPlanId: existing.capitalPlanId,
  }),
};

export const eventOverlay: OverlaySpec<LedgerEvent, EventWire> = {
  entity: "event",
  decode: decodeEvent,
  emptyWire: (id) => ({
    id,
    catId: "",
    date: "",
    allDay: false,
    time: null,
    repeat: "once",
    notify: false,
    lead: "at",
  }),
  wireFrom: (id, existing) => ({
    id,
    catId: existing.catId,
    date: existing.date,
    endDate: existing.endDate,
    allDay: existing.allDay,
    time: existing.time,
    endTime: existing.endTime,
    repeat: existing.repeat,
    exceptDates: existing.exceptDates,
    until: existing.until,
    notify: existing.notify,
    lead: existing.lead,
    email: existing.email,
    expenseId: existing.expenseId,
  }),
};

export const todoListOverlay: OverlaySpec<TodoList, TodoListWire> = {
  entity: "todoList",
  decode: decodeTodoList,
  emptyWire: (id) => ({ id }),
  wireFrom: (id) => ({ id }),
};

export const capitalPlanOverlay: OverlaySpec<CapitalPlan, CapitalPlanWire> = {
  entity: "capitalPlan",
  decode: decodeCapitalPlan,
  emptyWire: (id) => ({ id }),
  wireFrom: (id) => ({ id }),
};

export const vehicleOverlay: OverlaySpec<Vehicle, VehicleWire> = {
  entity: "vehicle",
  decode: decodeVehicle,
  emptyWire: (id) => ({ id, type: "car", createdAt: "" }),
  wireFrom: (id, existing) => ({ id, type: existing.type, createdAt: existing.createdAt }),
};

export const vehicleFillOverlay: OverlaySpec<FuelFill, VehicleFillWire> = {
  entity: "vehicleFill",
  decode: decodeVehicleFill,
  emptyWire: (id) => ({ id, vehicleId: "", date: "", partial: false }),
  wireFrom: (id, existing) => ({
    id,
    vehicleId: existing.vehicleId,
    date: existing.date,
    partial: existing.partial,
    expenseId: existing.expenseId,
  }),
};

/**
 * A "walletBudgets" write always targets an *existing* wallet id (it's
 * always `op: "update"`, never create/delete) — so it fits the same
 * list-shaped overlay as everything else above, folded onto the wallets
 * list by id. `emptyWire` is never actually hit (there is no create), but
 * still needs to type-check as a valid WalletWire skeleton.
 */
export const walletBudgetsOverlay: OverlaySpec<FinancialWallet, WalletWire> = {
  entity: "walletBudgets",
  decode: decodeWallet,
  emptyWire: (id) => ({ id, currency: "", fundingMode: "monthly", isDefault: false }),
  wireFrom: (id, existing) => ({
    id,
    currency: existing.currency,
    fundingMode: existing.fundingMode,
    isDefault: existing.isDefault,
    name: existing.name,
    income: existing.income,
    startingBalance: existing.startingBalance,
    budgets: existing.budgets,
  }),
};

/**
 * Categories is the one entity in this file that isn't list-shaped — it's a
 * single account-wide document with no id in its own path. "Overlay" for a
 * singleton is just "the newest pending write for this target wins",
 * decoded in place of the server-derived value.
 */
export async function applySingletonOverlay<T>(
  base: T,
  entries: OutboxEntry[],
  key: CryptoKey,
  opts: {
    entity: EntityKind;
    targetId: string;
    decode: (body: unknown, key: CryptoKey) => Promise<T>;
  },
): Promise<T> {
  const relevant = entries
    .filter((e) => e.entity === opts.entity && e.targetId === opts.targetId)
    .sort((a, b) => b.seq - a.seq);
  const newest = relevant[0];
  if (!newest) return base;

  try {
    return await opts.decode(newest.request.body, key);
  } catch (err) {
    console.error(
      `[sync] singleton overlay decode failed for ${opts.entity}:${opts.targetId}`,
      safeErrorName(err),
    );
    return base;
  }
}
