import { DELETE_SCOPES } from "@/lib/delete-scope";
import { EVENT_CATEGORY_IDS, LEAD_IDS, REPEAT_IDS } from "@/lib/event-rules";
import { z } from "zod";
import { categoryIdSchema } from "./category";

export { walletAddressSchema } from "./address";
export { accountIdSchema, objectIdSchema } from "./ids";

export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM");

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Date must be YYYY-MM-DD");

/** Inclusive ISO date bounds for a YYYY-MM month key (uses -31 so indexes apply). */
export function monthDateBounds(month: string): { $gte: string; $lte: string } {
  return { $gte: `${month}-01`, $lte: `${month}-31` };
}

export { categoryIdSchema, subcategoryIdSchema } from "./category";

export const budgetsSchema = z.record(categoryIdSchema, z.number().nonnegative());

export {
  EVENT_CATEGORY_IDS,
  LEAD_IDS,
  REPEAT_IDS,
  isLeadAllowedForEvent,
  isRepeatAllowedForSpan,
  spanDaysBetween,
  type LeadId,
  type RepeatId,
} from "@/lib/event-rules";

export const eventCategoryIdSchema = z.enum(EVENT_CATEGORY_IDS);
export const repeatIdSchema = z.enum(REPEAT_IDS);
export const leadIdSchema = z.enum(LEAD_IDS);

export const deleteScopeQuerySchema = z.object({
  scope: z.enum(DELETE_SCOPES).optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
