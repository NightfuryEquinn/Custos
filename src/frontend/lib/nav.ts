import { DEFAULT_TAB_IDS, TAB_SLOTS, type ViewId } from "@/lib/views";

/**
 * One entry per view: [id, label, icon]. The label is the single name used by
 * navigation, page titles, links and search.
 */
export const NAV_ITEMS = [
  ["overview", "Home", "overview"],
  ["daily", "Daily", "daily"],
  ["todos", "To-do", "checklist"],
  ["schedule", "Schedule", "calendar"],
  ["transactions", "Transactions", "list"],
  ["budgets", "Budgets", "budget"],
  ["recurring", "Recurring", "recurring"],
  ["vehicles", "Vehicles", "car"],
  ["categories", "Categories", "tags"],
  ["piggies", "Savings", "piggy"],
  ["capitals", "Big Expenses", "capital"],
  ["calculator", "Calculator", "calculator"],
  ["insights", "Insights", "insights"],
  ["transparency", "Transparency", "database"],
] as const satisfies ReadonlyArray<readonly [ViewId, string, string]>;

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
 * Which header controls change a page's content: w = wallet, m = month. A page not listed
 * shows neither, so Daily and To-do never inherit financial filters. Savings, Big Expenses
 * and Vehicles read the active wallet's data or currency, so they keep the wallet switcher.
 */
export const VIEW_CONTROLS: Partial<Record<ViewId, "w" | "m" | "wm">> = {
  overview: "wm",
  transactions: "wm",
  budgets: "wm",
  insights: "wm",
  recurring: "wm",
  piggies: "wm",
  schedule: "m",
  capitals: "w",
  vehicles: "w",
  calculator: "w",
};

/**
 * Destination groups for the sidebar and More sheet. Every view id appears in
 * exactly one group (tested); ids not yet in VIEW_IDS are skipped, so a group
 * can name a view before it ships.
 */
export const NAV_GROUPS: ReadonlyArray<readonly [label: string, ids: readonly string[]]> = [
  ["Everyday", ["overview", "daily", "todos", "schedule"]],
  ["Money", ["transactions", "budgets", "recurring", "piggies", "capitals", "insights"]],
  ["Tools", ["vehicles", "calculator", "categories", "transparency"]],
];

/**
 * Resolve stored nav preferences into the rendered lists, tolerating drift:
 * an id from a retired view is dropped, and the saved order applies within
 * each group, so a view the order never mentions keeps its group's default
 * slot instead of vanishing. Favorites lead the sidebar; `moreGroups` is the
 * rest, so no destination appears twice on either surface.
 */
export function resolveNav(navOrder?: readonly string[], navTabs?: readonly string[]) {
  const cleanOrder = sanitize(navOrder ?? []);
  const rank = (id: ViewId) => {
    const i = cleanOrder.indexOf(id);
    return i < 0 ? Infinity : i;
  };
  const groups = NAV_GROUPS.map(([label, ids]) => ({
    label,
    items: sanitize(ids)
      .sort((a, b) => rank(a) - rank(b))
      .map((id) => NAV_ITEM_BY_ID.get(id)!),
  }));
  const sidebarItems = groups.flatMap((g) => g.items);

  const cleanTabs = sanitize(navTabs ?? []);
  const tabIds = cleanTabs.length === TAB_SLOTS ? cleanTabs : [...DEFAULT_TAB_IDS];
  const tabItems = tabIds.map((id) => NAV_ITEM_BY_ID.get(id)!);
  const moreGroups = groups
    .map((g) => ({ ...g, items: g.items.filter(([id]) => !tabIds.includes(id)) }))
    .filter((g) => g.items.length > 0);

  return { sidebarItems, tabItems, groups, moreGroups };
}
