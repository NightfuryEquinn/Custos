import { DEFAULT_GLYPH } from "@/lib/glyphs";
import { z } from "zod";
import { accountIdSchema } from "./ids";
import { encryptedPayloadSchema, e2eeVersionSchema } from "./encryption";

// Duplicated from common.ts's isoDateSchema, not imported: common.ts imports
// categoryIdSchema from this file, so importing back would create a cycle.
const savingsDeadlineSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Date must be YYYY-MM-DD");

export const categoryIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9_]+$/, "Invalid category id");

export const subcategoryIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9_]+$/, "Invalid subcategory id");

const categoryTypeSchema = z.enum(["expense", "income", "savings"]);

const subcategorySchema = z.object({
  id: subcategoryIdSchema,
  name: z.string().trim().min(1).max(60),
  /**
   * Retired subcategory kept for historical classification. Hidden from
   * pickers; still resolvable so past transactions keep their type.
   */
  archived: z.boolean().default(false),
  /** Piggy goal for this subcategory. Meaningful only under a savings category. */
  target: z.number().nonnegative().optional(),
  deadline: savingsDeadlineSchema.optional(),
});

const categorySchema = z.object({
  id: categoryIdSchema,
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  glyph: z.string().min(1).max(8).default(DEFAULT_GLYPH),
  type: categoryTypeSchema.default("expense"),
  builtin: z.boolean().default(false),
  /**
   * Retired category kept for historical classification. Hidden from pickers
   * and budget editors, but still resolvable so past transactions keep their
   * type — deleting a savings category outright would silently reclassify its
   * whole history as spending. Built-in and custom categories follow the same
   * rule: unused categories are deleted, in-use ones are archived.
   */
  archived: z.boolean().default(false),
  /** Piggy goal for this category. Meaningful only when type is "savings". */
  target: z.number().nonnegative().optional(),
  deadline: savingsDeadlineSchema.optional(),
  subs: z.array(subcategorySchema).min(1),
});

const categoryTaxonomySchema = z.object({
  accountId: accountIdSchema,
  enc: e2eeVersionSchema.optional(),
  payload: encryptedPayloadSchema.optional(),
  /** Legacy plaintext tree (pre-E2EE). */
  categories: z.array(categorySchema).min(1).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const updateCategoriesSchema = z.object({
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
});

export type Category = z.infer<typeof categorySchema>;
export type CategoryTaxonomy = z.infer<typeof categoryTaxonomySchema>;
