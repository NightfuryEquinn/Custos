import { DEFAULT_TAB_IDS, TAB_SLOTS, VIEW_IDS, type ViewId } from "@/lib/views";

/**
 * One entry per view: [id, label, icon, shortLabel?]. `shortLabel` is used in
 * the mobile tab bar, which is 10px and ellipsizing and now shows whichever
 * views the user picks — not just the four this used to be tuned for.
 */
export const NAV_ITEMS = [
  ["overview", "Overview", "overview"],
  ["todos", "TO-DO List", "checklist", "To-Do"],
  ["schedule", "Schedule", "calendar"],
  ["transactions", "Transactions", "list"],
  ["budgets", "Budgets", "budget"],
  ["recurring", "Recurring", "recurring"],
  ["vehicles", "Vehicles", "car"],
  ["categories", "Categories", "tags"],
  ["piggies", "Piggies", "piggy"],
  ["capitals", "Capitals", "capital"],
  ["calculator", "Calculator", "calculator"],
  ["insights", "Insights", "insights"],
  ["transparency", "Transparency", "database"],
] as const satisfies ReadonlyArray<readonly [ViewId, string, string, string?]>;

export type NavItem = (typeof NAV_ITEMS)[number];

export const NAV_ITEM_BY_ID = new Map<ViewId, NavItem>(NAV_ITEMS.map((item) => [item[0], item]));

/** De-dupe while keeping first occurrence, dropping ids not in the current view list. */
function sanitize(ids: readonly string[]): ViewId[] {
  const seen = new Set<ViewId>();
  const out: ViewId[] = [];
  for (const id of ids) {
    if (!NAV_ITEM_BY_ID.has(id as ViewId) || seen.has(id as ViewId)) continue;
    seen.add(id as ViewId);
    out.push(id as ViewId);
  }
  return out;
}

/**
 * Resolve stored nav preferences into the three rendered lists, tolerating
 * drift: an id from a retired view is dropped, and a view the stored order
 * never mentions (new since the user last customized it) is appended so it
 * stays reachable instead of vanishing from both the sidebar and More.
 */
export function resolveNav(navOrder?: readonly string[], navTabs?: readonly string[]) {
  const cleanOrder = sanitize(navOrder ?? []);
  const missing = VIEW_IDS.filter((id) => !cleanOrder.includes(id));
  const sidebarIds = [...cleanOrder, ...missing];

  const cleanTabs = sanitize(navTabs ?? []);
  const tabIds = cleanTabs.length === TAB_SLOTS ? cleanTabs : [...DEFAULT_TAB_IDS];
  const tabIdSet = new Set(tabIds);

  const sidebarItems = sidebarIds.map((id) => NAV_ITEM_BY_ID.get(id)!);
  const tabItems = tabIds.map((id) => NAV_ITEM_BY_ID.get(id)!);
  const moreItems = sidebarItems.filter((item) => !tabIdSet.has(item[0]));

  return { sidebarItems, tabItems, moreItems };
}
