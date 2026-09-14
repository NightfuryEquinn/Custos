import { z } from "zod";
import { encryptedPayloadSchema, e2eeVersionSchema } from "./encryption";
import { objectIdSchema } from "./ids";

export const createCapitalPlanSchema = z.object({
  /** Optional client-minted id (offline write queue) — see expense.ts's `id`. */
  id: objectIdSchema.optional(),
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
});

export const updateCapitalPlanSchema = z.object({
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
});
