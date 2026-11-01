import type { Category } from "@/schemas/category";

/** Default live subcategory for the new-account taxonomy. */
function defaultSub(id: string, name: string) {
  return { id, name, archived: false };
}

/* Default taxonomy for new accounts — cool muted palette. */
export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: "food",
    name: "Food & Dining",
    color: "#5b7a8a",
    glyph: "🍽️",
    type: "expense",
    builtin: true,
    archived: false,
    subs: [
      defaultSub("groceries", "Groceries"),
      defaultSub("meal", "Meal"),
      defaultSub("snacks", "Snacks"),
    ],
  },
  {
    id: "transport",
    name: "Transport",
    color: "#6f8b6f",
    glyph: "🚗",
    type: "expense",
    builtin: true,
    archived: false,
    subs: [defaultSub("petrol", "Petrol"), defaultSub("transportation", "Transportation")],
  },
  {
    id: "utilities",
    name: "Bills & Utilities",
    color: "#4f8a7b",
    glyph: "💡",
    type: "expense",
    builtin: true,
    archived: false,
    subs: [
      defaultSub("electricity", "Electricity"),
      defaultSub("water", "Water"),
      defaultSub("internet", "Internet"),
    ],
  },
  {
    id: "sport",
    name: "Health & Sport",
    color: "#4a6fa5",
    glyph: "🏃",
    type: "expense",
    builtin: true,
    archived: false,
    subs: [defaultSub("gym", "Sport")],
  },
  {
    id: "fun",
    name: "Entertainment",
    color: "#a06f95",
    glyph: "🎬",
    type: "expense",
    builtin: true,
    archived: false,
    subs: [
      defaultSub("streaming", "Streaming"),
      defaultSub("outings", "Outings"),
      defaultSub("games", "Games"),
    ],
  },
  {
    id: "savings",
    name: "Savings",
    color: "#7a6fa5",
    glyph: "🐷",
    type: "savings",
    builtin: true,
    archived: false,
    subs: [defaultSub("saving", "Saving")],
  },
  {
    id: "income",
    name: "Income",
    color: "#6f8b6f",
    glyph: "💵",
    type: "income",
    builtin: true,
    archived: false,
    subs: [
      defaultSub("salary", "Salary"),
      defaultSub("wages", "Wages"),
      defaultSub("bonus", "Bonus"),
      defaultSub("funds", "Funds"),
      defaultSub("other_income", "Other"),
    ],
  },
];

/**
 * Validate a plaintext category taxonomy (unique ids, ≥1 income + ≥1 expense).
 * Used client-side before encrypting; the server cannot inspect ciphertext.
 */
export function validateTaxonomy(
  categories: Array<{
    id: string;
    type?: "expense" | "income" | "savings";
    archived?: boolean;
    target?: number;
    deadline?: string;
    subs: Array<{ id: string; target?: number; deadline?: string }>;
  }>,
): string | null {
  const catIds = new Set<string>();
  const subIds = new Set<string>();
  let hasIncome = false;
  let hasExpense = false;

  for (const cat of categories) {
    if (catIds.has(cat.id)) return `Duplicate category id: ${cat.id}`;
    catIds.add(cat.id);

    const type =
      cat.type === "income" || cat.id === "income"
        ? "income"
        : cat.type === "savings" || cat.id === "savings"
          ? "savings"
          : "expense";

    // A target/deadline only means something on a piggy; on any other
    // category type it would render nowhere and confuse export.
    if (type !== "savings") {
      if (cat.target !== undefined || cat.deadline !== undefined) {
        return `Category "${cat.id}" is not a savings category and cannot have a target or deadline`;
      }
      if (cat.subs.some((s) => s.target !== undefined || s.deadline !== undefined)) {
        return `Category "${cat.id}" is not a savings category and its subcategories cannot have a target or deadline`;
      }
    }

    // Archived categories still occupy their ids, but cannot satisfy the
    // "at least one income / expense" rule — otherwise archiving the only
    // income category would leave the pickers empty.
    if (!cat.archived) {
      if (type === "income") hasIncome = true;
      else if (type === "expense") hasExpense = true;
    }

    for (const sub of cat.subs) {
      if (subIds.has(sub.id)) return `Duplicate subcategory id: ${sub.id}`;
      subIds.add(sub.id);
    }
  }

  if (!hasIncome) return "At least one income category is required";
  if (!hasExpense) return "At least one expense category is required";

  return null;
}
