/**
 * Rebuilds what the ledger looks like with pending outbox entries applied,
 * by decoding each entry's own (already-encrypted) request body through the
 * existing codec functions — the same `decodeExpense` a real server
 * response goes through. No separate plaintext copy is stored anywhere: the
 * outbox holds ciphertext, and the overlay decrypts it at read time with
 * whatever key is currently unlocked.
 *
 * This is the mechanism that makes "close the app while offline, reopen it"
 * work — it's rebuilt from the durable outbox on every call, not from an
 * in-memory optimistic patch that dies on reload.
 */

import { decodeExpense, type ExpenseWire } from "@/frontend/lib/crypto/codec";
import type { Expense } from "@/frontend/lib/types";
import type { OutboxEntry } from "./types";

/** Merge a patch body's *present* keys onto a base wire; absent keys are untouched. */
function mergeWire(base: ExpenseWire, patch: Record<string, unknown>): ExpenseWire {
  const merged = { ...base };
  for (const key of Object.keys(patch)) {
    (merged as Record<string, unknown>)[key] = patch[key];
  }
  return merged;
}

/** Layer pending expense creates/updates/deletes over server-derived rows. */
export async function applyExpenseOverlay(
  base: Expense[],
  entries: OutboxEntry[],
  key: CryptoKey,
): Promise<Expense[]> {
  const relevant = entries.filter((e) => e.entity === "expense").sort((a, b) => a.seq - b.seq);
  if (!relevant.length) return base;

  let result = base;
  const wireById = new Map<string, ExpenseWire>();

  for (const entry of relevant) {
    if (entry.op === "delete") {
      result = result.filter((e) => e.id !== entry.targetId);
      wireById.delete(entry.targetId);
      continue;
    }

    const patch = (entry.request.body ?? {}) as Record<string, unknown>;
    const existingWire = wireById.get(entry.targetId);
    const baseWire: ExpenseWire =
      entry.op === "create"
        ? { id: entry.targetId, walletId: "", kind: "expense", date: "", recurring: false }
        : (existingWire ?? wireFromExpense(entry.targetId, result));
    const wire = mergeWire(baseWire, { ...patch, id: entry.targetId });
    wireById.set(entry.targetId, wire);

    try {
      const decoded = await decodeExpense(wire, key);
      if (entry.op === "create") {
        result = result.some((e) => e.id === decoded.id)
          ? result.map((e) => (e.id === decoded.id ? decoded : e))
          : [decoded, ...result];
      } else {
        result = result.map((e) => (e.id === entry.targetId ? decoded : e));
      }
    } catch {
      /* A decode failure here (e.g. a key mismatch mid-rekey) just means the
         overlay skips this one entry — the underlying server data still
         renders once the entry actually confirms. */
    }
  }

  return result;
}

/** Reconstruct a base wire shape from an already-decoded Expense, for merging an update onto it. */
function wireFromExpense(id: string, list: Expense[]): ExpenseWire {
  const existing = list.find((e) => e.id === id);
  if (!existing) {
    return { id, walletId: "", kind: "expense", date: "", recurring: false };
  }
  return {
    id,
    walletId: existing.walletId,
    kind: existing.kind,
    date: existing.date,
    recurring: existing.recurring,
    eventId: existing.eventId,
    capitalPlanId: existing.capitalPlanId,
  };
}
