import { z } from "zod";
import { accountIdSchema, budgetsSchema, objectIdSchema } from "./common";
import { encryptedPayloadSchema, e2eeVersionSchema } from "./encryption";

export const CURRENCY_CODES = [
  "AED",
  "AUD",
  "BDT",
  "BND",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "EUR",
  "GBP",
  "HKD",
  "IDR",
  "INR",
  "JPY",
  "KRW",
  "MXN",
  "MYR",
  "NZD",
  "PHP",
  "PKR",
  "SAR",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "TWD",
  "USD",
  "VND",
  "ZAR",
] as const;

const currencyCodeSchema = z.enum(CURRENCY_CODES);

const fundingModeSchema = z.enum(["monthly", "starting"]);

const financialWalletSchema = z.object({
  accountId: accountIdSchema,
  /** Legacy plaintext name (pre-E2EE); prefer payload secrets. */
  name: z.string().trim().min(1).max(60).optional(),
  currency: currencyCodeSchema,
  fundingMode: fundingModeSchema.default("monthly"),
  enc: e2eeVersionSchema.optional(),
  payload: encryptedPayloadSchema.optional(),
  income: z.number().nonnegative().optional(),
  startingBalance: z.number().nonnegative().optional(),
  budgets: budgetsSchema.optional(),
  isDefault: z.boolean().default(false),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createWalletSchema = z.object({
  /** Optional client-minted id (offline write queue) — see expense.ts's `id`. */
  id: objectIdSchema.optional(),
  currency: currencyCodeSchema,
  fundingMode: fundingModeSchema.optional().default("monthly"),
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
});

export const updateWalletSchema = z
  .object({
    currency: currencyCodeSchema.optional(),
    fundingMode: fundingModeSchema.optional(),
    isDefault: z.boolean().optional(),
    enc: e2eeVersionSchema.optional(),
    payload: encryptedPayloadSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  })
  .refine((data) => (data.enc == null) === (data.payload == null), {
    message: "enc and payload must be provided together",
  });

export type FinancialWallet = z.infer<typeof financialWalletSchema>;
export type CreateWalletInput = z.infer<typeof createWalletSchema>;
