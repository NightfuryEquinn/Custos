import { z } from "zod";
import { accountIdSchema, monthKeySchema } from "./common";
import { TERMS_VERSION } from "@/lib/legal";
import { ACCENT_NAMES } from "@/lib/accents";
import { TAB_SLOTS, VIEW_IDS } from "@/lib/views";

const accentSchema = z.enum(ACCENT_NAMES as [string, ...string[]]);

const viewIdSchema = z.enum(VIEW_IDS);
const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;

/** Exactly the mobile tab-bar picks, in display order. */
const navTabsSchema = z
  .array(viewIdSchema)
  .length(TAB_SLOTS)
  .refine(uniqueIds, "Tab picks must be unique");
/* Lenient on length (not exactly VIEW_IDS.length) so a client's stale order —
   from before a view existed, or one it never touched — still validates; the
   frontend's resolveNav() fills any gaps against the current view list. */
const navOrderSchema = z
  .array(viewIdSchema)
  .max(VIEW_IDS.length)
  .refine(uniqueIds, "Sidebar order must not repeat a view");

/**
 * How the user answered the first-run tour prompt.
 *
 * `pending` — never asked, so the welcome modal is due.
 * `guided`  — wants the walkthrough; tours auto-open per view on first visit.
 * `explore` — wants to look around alone; nothing auto-opens ever again.
 */
export const tourPreferenceSchema = z.enum(["pending", "guided", "explore"]);

/** Tour ids already shown to this user: "shell" plus any view id. */
const toursSeenSchema = z.array(z.string().max(32)).max(32);

/** Per-user ledger UI state. Budgets/income live on financial_wallets (E2EE). */
const ledgerProfileSchema = z.object({
  accountId: accountIdSchema,
  currentMonth: monthKeySchema,
  /* Onboarding lives here rather than in localStorage so the answer follows the
     user across devices and survives sign-out and Clear Local Data. */
  tourPreference: tourPreferenceSchema.default("pending"),
  toursSeen: toursSeenSchema.default([]),
  /* Version of the Terms this account has accepted. Recorded server-side (not
     localStorage) so it follows the account across devices and survives
     Clear Local Data; undefined means "never accepted". */
  termsVersion: z.string().max(32).optional(),
  /* Accent color pick — free for every account, no gate to check. */
  accent: accentSchema.optional(),
  /* Custom nav layout. Undefined means "never customized" — the client falls
     back to the built-in defaults, so there's nothing to seed here. */
  navTabs: navTabsSchema.optional(),
  navOrder: navOrderSchema.optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const updateProfileSchema = z
  .object({
    currentMonth: monthKeySchema.optional(),
    tourPreference: tourPreferenceSchema.optional(),
    toursSeen: toursSeenSchema.optional(),
    /* Literal, not a free string — a client cannot declare acceptance of a
       version it was never shown. */
    termsVersion: z.literal(TERMS_VERSION).optional(),
    accent: accentSchema.optional(),
    navTabs: navTabsSchema.optional(),
    navOrder: navOrderSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export type LedgerProfile = z.infer<typeof ledgerProfileSchema>;
export type TourPreference = z.infer<typeof tourPreferenceSchema>;

/** Seed a new ledger profile for an account. */
export function defaultProfile(
  accountId: string,
  currentMonth?: string,
): Omit<LedgerProfile, "createdAt" | "updatedAt"> {
  const now = new Date();
  const month =
    currentMonth ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return {
    accountId: accountIdSchema.parse(accountId),
    currentMonth: monthKeySchema.parse(month),
    tourPreference: "pending",
    toursSeen: [],
  };
}
