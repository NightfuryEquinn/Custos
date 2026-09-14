import { RECURRING_INTERVALS } from "@/lib/recurring";
import { z } from "zod";
import { encryptedPayloadSchema, e2eeVersionSchema, seriesKeySchema } from "./encryption";
import { accountIdSchema, isoDateSchema, objectIdSchema, subcategoryIdSchema } from "./common";

const txnKindSchema = z.enum(["expense", "income"]);

const recurringIntervalSchema = z.enum(RECURRING_INTERVALS);

const recurringFieldSchema = z.preprocess(
  (val) => {
    if (val === true) return "monthly";
    if (val === false || val === null || val === undefined) return false;
    return val;
  },
  z.union([recurringIntervalSchema, z.literal(false)]),
);

const recurringFieldInputSchema = z
  .union([recurringIntervalSchema, z.literal(false)])
  .default(false);

const expenseMetaSchema = z.object({
  /** Optional client-minted id (offline write queue) — random ObjectId hex,
   *  no embedded timestamp, same shape the server would generate itself. */
  id: objectIdSchema.optional(),
  walletId: objectIdSchema,
  kind: txnKindSchema.optional().default("expense"),
  date: isoDateSchema,
  recurring: recurringFieldInputSchema.optional().default(false),
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
  seriesKey: seriesKeySchema.optional(),
  /** Optional schedule event this expense was logged from. */
  eventId: objectIdSchema.optional(),
  /** Optional Capitals plan this savings deposit is assigned to. */
  capitalPlanId: objectIdSchema.optional(),
});

export const createExpenseSchema = expenseMetaSchema;

export const updateExpenseSchema = z
  .object({
    walletId: objectIdSchema.optional(),
    kind: txnKindSchema.optional(),
    date: isoDateSchema.optional(),
    recurring: recurringFieldInputSchema.optional(),
    enc: e2eeVersionSchema,
    payload: encryptedPayloadSchema,
    seriesKey: seriesKeySchema.nullable().optional(),
    eventId: objectIdSchema.nullable().optional(),
    capitalPlanId: objectIdSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

const expenseSchema = z.object({
  accountId: accountIdSchema,
  walletId: objectIdSchema.optional(),
  kind: txnKindSchema.default("expense"),
  date: isoDateSchema,
  recurring: recurringFieldSchema.default(false),
  enc: e2eeVersionSchema.optional(),
  payload: encryptedPayloadSchema.optional(),
  seriesKey: seriesKeySchema.optional(),
  eventId: objectIdSchema.optional(),
  capitalPlanId: objectIdSchema.optional(),
  /** Soft-deleted occurrence kept so cron does not rematerialize it. */
  skipped: z.boolean().optional().default(false),
  /** Legacy plaintext fields. */
  sub: subcategoryIdSchema.optional(),
  amount: z.number().positive().optional(),
  note: z.string().max(500).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const listExpensesQuerySchema = z.object({
  walletId: objectIdSchema.optional(),
  kind: txnKindSchema.optional(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional().default(2000),
  before: isoDateSchema.optional(),
  beforeId: objectIdSchema.optional(),
  recurring: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

export type Expense = z.infer<typeof expenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
