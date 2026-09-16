/**
 * Every ledger view id — the shared name/order map. Lives here (not
 * @/frontend/lib/types) so both the frontend nav and the server-side profile
 * schema (which validates `navTabs`/`navOrder` on PATCH /profile) can import
 * the same list without a schema depending on frontend UI code. Mirrors the
 * @/lib/accents precedent for the same reason.
 */
export const VIEW_IDS = [
  "overview",
  "todos",
  "schedule",
  "transactions",
  "budgets",
  "recurring",
  "vehicles",
  "categories",
  "piggies",
  "capitals",
  "calculator",
  "insights",
  "transparency",
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

/** Default mobile tab-bar picks — the 5th slot is always More. */
export const DEFAULT_TAB_IDS = ["overview", "schedule", "transactions", "todos"] as const;

/** How many views the mobile tab bar shows before the More sheet. */
export const TAB_SLOTS = DEFAULT_TAB_IDS.length;
