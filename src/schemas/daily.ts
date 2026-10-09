import { z } from "zod";
import { isoDateSchema } from "./common";
import { e2eeVersionSchema, encryptedPayloadSchema } from "./encryption";
import { objectIdSchema } from "./ids";

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
  routineId: objectIdSchema,
  period: isoDateSchema,
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
});
