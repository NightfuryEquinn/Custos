import { z } from "zod";
import { encryptedPayloadSchema, e2eeVersionSchema } from "./encryption";
import { isoDateSchema, objectIdSchema } from "./common";

const VEHICLE_TYPES = ["car", "ev", "bike", "van"] as const;
const vehicleTypeSchema = z.enum(VEHICLE_TYPES);

export const createVehicleSchema = z.object({
  /** Optional client-minted id (offline write queue) — see expense.ts's `id`. */
  id: objectIdSchema.optional(),
  type: vehicleTypeSchema,
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
});

export const updateVehicleSchema = z
  .object({
    type: vehicleTypeSchema.optional(),
    enc: e2eeVersionSchema,
    payload: encryptedPayloadSchema,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

const vehicleFillMetaSchema = z.object({
  /** Optional client-minted id (offline write queue) — see expense.ts's `id`. */
  id: objectIdSchema.optional(),
  vehicleId: objectIdSchema,
  date: isoDateSchema,
  partial: z.boolean().optional().default(false),
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
  /** Optional link to a ledger expense once "Log to ledger" runs. */
  expenseId: objectIdSchema.optional(),
});

export const createVehicleFillSchema = vehicleFillMetaSchema;

export const updateVehicleFillSchema = z
  .object({
    vehicleId: objectIdSchema.optional(),
    date: isoDateSchema.optional(),
    partial: z.boolean().optional(),
    enc: e2eeVersionSchema,
    payload: encryptedPayloadSchema,
    expenseId: objectIdSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const listVehicleFillsQuerySchema = z.object({
  vehicleId: objectIdSchema.optional(),
  from: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional().default(2000),
  before: isoDateSchema.optional(),
  beforeId: objectIdSchema.optional(),
});
