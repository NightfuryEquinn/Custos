import { z } from "zod";
import { isoDateSchema } from "./common";
import { e2eeVersionSchema, encryptedPayloadSchema } from "./encryption";
import { objectIdSchema } from "./ids";

/**
 * A period key must be a real calendar day. Kept to Daily on purpose: the shared
 * isoDateSchema also guards live expense and event writes and is left as it is.
 */
const periodSchema = isoDateSchema.refine((day) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));

  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}, "Not a real calendar date");

/** A routine: title, notes, recurrence and archive state all live inside the ciphertext. */
export const createDailyRoutineSchema = z.object({
  /** Optional client-minted id (offline write queue) — see expense.ts's `id`. */
  id: objectIdSchema.optional(),
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
});

export const updateDailyRoutineSchema = z.object({
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
});

/**
 * Set one routine's checkbox for one period. `period` is a calendar key (a day,
 * or a week's Monday) and stays in the clear so one row per routine and period
 * can be enforced; the done state is inside the ciphertext.
 */
export const putDailyCompletionSchema = z.object({
  /* Lower-cased so one routine can never appear under two spellings of its id. */
  routineId: objectIdSchema.transform((id) => id.toLowerCase()),
  period: periodSchema,
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
});
