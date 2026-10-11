import { NUDGE_EVERY_STEP, NUDGE_MAX_EVERY, NUDGE_MIN_EVERY, toMinutes } from "@/lib/nudge";
import { z } from "zod";
import { isoDateSchema } from "./common";
import { e2eeVersionSchema, encryptedPayloadSchema } from "./encryption";
import { objectIdSchema } from "./ids";

const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:mm");

/**
 * Server-readable copy of what the push shows. Nudge content stays E2EE, so the
 * client sends this beside the ciphertext only while the nudge is switched on;
 * the notification body is plaintext, so turning a nudge on is the consent point.
 */
export const nudgeDetailsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(300),
});

/**
 * Everything the server needs to fire a nudge on time, kept in the clear: whether it
 * is on, the interval and daily window, the date its goal was met (so a finished nudge
 * stays quiet), and the readable copy. Title, description, goal and count stay inside
 * the ciphertext.
 */
const nudgeShape = {
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
  enabled: z.boolean(),
  everyMin: z
    .number()
    .int()
    .min(NUDGE_MIN_EVERY)
    .max(NUDGE_MAX_EVERY)
    .refine(
      (n) => n % NUDGE_EVERY_STEP === 0,
      `Interval must be a multiple of ${NUDGE_EVERY_STEP}`,
    ),
  windowStart: hhmmSchema,
  windowEnd: hhmmSchema,
  notifyDetails: nudgeDetailsSchema.nullable(),
  metOn: isoDateSchema.nullable(),
};

const windowOrdered = (data: { windowStart: string; windowEnd: string }) =>
  toMinutes(data.windowStart) < toMinutes(data.windowEnd);
const WINDOW_MESSAGE = { message: "The window must end after it starts", path: ["windowEnd"] };

export const createNudgeSchema = z
  .object({
    /** Optional client-minted id (offline write queue) — see expense.ts's `id`. */
    id: objectIdSchema.optional(),
    ...nudgeShape,
  })
  .refine(windowOrdered, WINDOW_MESSAGE);

/** A PATCH replaces the whole document: the client always holds the full nudge. */
export const updateNudgeSchema = z.object(nudgeShape).refine(windowOrdered, WINDOW_MESSAGE);
