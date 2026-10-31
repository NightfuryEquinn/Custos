import { z } from "zod";
import { accountIdSchema } from "./common";

const consentSchema = z.object({
  accountId: accountIdSchema,
  optedIn: z.boolean().default(false),
  personalizationSerial: z.number().optional(),
  personalization: z
    .object({ enabled: z.boolean(), noticeVersion: z.string(), epoch: z.number() })
    .optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const updateConsentSchema = z.object({
  optedIn: z.boolean().optional(),
  personalization: z
    .object({
      enabled: z.boolean(),
      noticeVersion: z.string(),
      expectedEpoch: z.number().int().nonnegative(),
    })
    .optional(),
});

export type Consent = z.infer<typeof consentSchema>;
