import { z } from "zod";
import { accountIdSchema } from "./common";

const consentSchema = z.object({
  accountId: accountIdSchema,
  optedIn: z.boolean().default(false),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const updateConsentSchema = z.object({
  optedIn: z.boolean(),
});

export type Consent = z.infer<typeof consentSchema>;
