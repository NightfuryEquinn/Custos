import { mergeCategoryBudget } from "./category-retire";
import type { Budgets, SubcategoryBudgets } from "./types";

/** Transfers are repeat-safe because moved source entries are removed. */
export function transferBudgetBreakdown(
  budgets: Budgets,
  breakdown: SubcategoryBudgets,
  args: {
    sourceCatId?: string;
    sourceSubIds: string[];
    destCatId: string;
    destSubId: string;
    destType: string;
  },
) {
  const next =
    args.sourceCatId && args.sourceCatId !== args.destCatId
      ? mergeCategoryBudget(budgets, args.sourceCatId, args.destCatId, args.destType !== "income")
      : { ...budgets };
  const children = Object.fromEntries(
    Object.entries(breakdown).map(([id, values]) => [id, { ...values }]),
  );
  let moved = 0;
  for (const [catId, values] of Object.entries(children)) {
    let removed = 0;
    for (const sub of args.sourceSubIds) {
      if (catId === args.destCatId && sub === args.destSubId) continue;
      removed += values[sub] ?? 0;
      delete values[sub];
    }
    moved += removed;
    if (!args.sourceCatId && catId !== args.destCatId && removed)
      next[catId] = Math.max(0, Math.round(((next[catId] ?? 0) - removed) * 100) / 100);
  }
  if (args.sourceCatId && args.sourceCatId !== args.destCatId) {
    delete next[args.sourceCatId];
    delete children[args.sourceCatId];
  } else if (!args.sourceCatId && args.destType !== "income") {
    // Only add amounts that came from another parent.
    const sameParent = args.sourceSubIds.reduce(
      (sum, sub) => sum + (sub === args.destSubId ? 0 : (breakdown[args.destCatId]?.[sub] ?? 0)),
      0,
    );
    if (moved > sameParent) next[args.destCatId] = (next[args.destCatId] ?? 0) + moved - sameParent;
  }
  if (moved && args.destType !== "income") {
    const dest = children[args.destCatId] ?? {};
    children[args.destCatId] = {
      ...dest,
      [args.destSubId]: Math.round(((dest[args.destSubId] ?? 0) + moved) * 100) / 100,
    };
  }
  return { budgets: next, subcategoryBudgets: children };
}
