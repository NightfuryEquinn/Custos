import type { useLedger } from "@/frontend/lib/hooks/useLedger";
import type { Expense, LedgerEvent, FuelFill } from "@/frontend/lib/types";
import type { NudgeCheckIn } from "@/lib/nudge";
import { NAV_ITEMS } from "@/frontend/lib/nav";
import type { SearchDocument, SearchTarget } from "./model";

export type SearchLedger = ReturnType<typeof useLedger>;
export type SearchSource = Pick<
  SearchLedger,
  "wallets" | "categoryIndex" | "todoLists" | "capitalPlans" | "vehicles"
> & {
  daily: Pick<SearchLedger["daily"], "routines" | "completions">;
  nudges: Pick<SearchLedger["nudges"], "nudges">;
};
export type SearchHistory = {
  expenses: Expense[];
  events: LedgerEvent[];
  fills: FuelFill[];
  checkIns: NudgeCheckIn[];
};
export const SEARCH_SETTINGS = [
  ["preferences", "Preferences", "notifications push reminders biometric Face ID Touch ID"],
  ["navigation", "Navigation", "favorites start page order"],
  ["privacy", "Data & privacy", "sessions devices consent local data"],
  ["exports", "Exports & imports", "backup restore CSV download"],
  ["recovery", "Recovery phrase", "identity recovery"],
  ["support", "Support Custos", "tips donations"],
  ["terms", "Terms of use", "legal license"],
  ["copyright", "Copyright", "license ownership"],
  ["tour", "Take a tour", "help guide walkthrough"],
  ["timezone", "Timezone", "account time zone"],
  ["appearance", "Appearance", "theme light dark mode"],
  ["whats-new", "What's new", "release updates"],
] as const;

/** Build only user-facing searchable fields; keys and account secrets never enter the index. */
export function buildSearchDocuments(
  ledger: SearchSource,
  history: SearchHistory,
): SearchDocument[] {
  const documents: SearchDocument[] = [];
  /** Add one result with a stable identity and destination. */
  const add = (
    title: string,
    context: string,
    text: string,
    group: string,
    target: SearchTarget,
    suffix = "",
  ) => {
    documents.push({
      key: `${target.kind}:${target.parentId ?? ""}:${target.id}:${suffix}`,
      title,
      context,
      text,
      group,
      target,
    });
  };
  for (const [id, label] of NAV_ITEMS)
    add(label, "Page", id, "Pages", { kind: "page", view: id, id });
  for (const [id, title, text] of SEARCH_SETTINGS)
    add(title, "Account", text, "Settings", { kind: "setting", view: "overview", id });
  const wallets = new Map(ledger.wallets.map((wallet) => [wallet.id, wallet]));
  const { catById, subById, allCategories } = ledger.categoryIndex;
  for (const wallet of ledger.wallets) {
    add(wallet.name, wallet.currency, `${wallet.income} ${wallet.startingBalance}`, "Wallets", {
      kind: "wallet",
      view: "overview",
      id: wallet.id,
      walletId: wallet.id,
    });
    for (const [id, amount] of Object.entries(wallet.budgets)) {
      add(
        catById[id]?.name ?? id,
        `${wallet.name} · ${amount} ${wallet.currency}`,
        "budget allocation",
        "Budgets",
        { kind: "budget", view: "budgets", id, walletId: wallet.id },
      );
    }
    for (const [parentId, allocations] of Object.entries(wallet.subcategoryBudgets ?? {})) {
      for (const [id, amount] of Object.entries(allocations))
        add(
          subById[id]?.name ?? id,
          `${wallet.name} · ${amount} ${wallet.currency}`,
          `${catById[parentId]?.name ?? ""} budget allocation`,
          "Budgets",
          { kind: "budget", view: "budgets", id: parentId, parentId: id, walletId: wallet.id },
        );
    }
  }
  for (const category of allCategories) {
    add(
      category.name,
      category.archived
        ? "Archived category"
        : category.type === "savings"
          ? "Savings goal"
          : "Category",
      `${category.type ?? "expense"} ${category.target ?? ""} ${category.deadline ?? ""} piggies`,
      "Categories",
      { kind: "category", view: "categories", id: category.id },
    );
    for (const sub of category.subs)
      add(
        sub.name,
        `${category.name}${sub.archived ? " · Archived" : ""}`,
        `${sub.target ?? ""} ${sub.deadline ?? ""}`,
        "Categories",
        { kind: "category", view: "categories", id: sub.id, parentId: category.id },
      );
  }
  for (const expense of history.expenses) {
    const wallet = wallets.get(expense.walletId);
    const sub = subById[expense.sub];
    add(
      expense.note || sub?.name || "Transaction",
      `${expense.amount} ${wallet?.currency ?? ""} · ${expense.date} · ${wallet?.name ?? "Wallet unavailable"}`,
      `${expense.kind} ${sub?.name ?? ""} ${catById[sub?.catId ?? ""]?.name ?? ""} ${expense.recurring ? "recurring" : ""}`,
      "Transactions",
      {
        kind: "expense",
        view: "transactions",
        id: expense.id,
        walletId: expense.walletId,
        date: expense.date,
      },
    );
  }
  for (const event of history.events)
    add(
      event.title,
      `${event.date} · ${event.time ?? "All day"}`,
      `${event.customLabel ?? event.catId} ${event.endDate ?? ""} ${event.comments.map((comment) => comment.text).join(" ")} ${event.budgetHoldAmount ?? ""}`,
      "Schedule",
      { kind: "event", view: "schedule", id: event.id, date: event.date },
    );
  for (const list of ledger.todoLists) {
    add(list.name, "To-do list", "tasks", "To-do", { kind: "todo", view: "todos", id: list.id });
    for (const task of list.tasks)
      add(task.title, `${list.name} · ${task.done ? "Completed" : "To do"}`, "task", "To-do", {
        kind: "todo",
        view: "todos",
        id: task.id,
        parentId: list.id,
      });
  }
  for (const routine of ledger.daily.routines) {
    add(
      routine.title,
      routine.archivedOn ? "Archived routine" : "Daily routine",
      routine.notes,
      "Daily",
      { kind: "daily", view: "daily", id: routine.id },
    );
    for (const completion of ledger.daily.completions.filter((row) => row.routineId === routine.id))
      add(
        routine.title,
        `${completion.period} · ${completion.done ? "Completed" : "Incomplete"}`,
        routine.notes,
        "Daily",
        { kind: "daily", view: "daily", id: routine.id, date: completion.period },
        completion.id,
      );
  }
  const nudges = new Map(ledger.nudges.nudges.map((row) => [row.id, row]));
  for (const nudge of nudges.values()) {
    add(
      nudge.title,
      `${nudge.target} ${nudge.unit} · ${nudge.enabled ? "On" : "Paused"}`,
      nudge.description,
      "Nudges",
      { kind: "nudge", view: "nudge", id: nudge.id },
    );
    const days = { ...nudge.history, [nudge.progress.day]: nudge.progress.count };
    for (const [date, count] of Object.entries(days))
      add(
        nudge.title,
        `${date} · ${count} ${nudge.unit}`,
        nudge.description,
        "Nudges",
        { kind: "nudge", view: "nudge", id: nudge.id, date },
        date,
      );
  }
  for (const event of history.checkIns) {
    const nudge = nudges.get(event.nudgeId);
    if (nudge)
      add(
        nudge.title,
        `${event.day} · ${event.delta > 0 ? "+" : ""}${event.delta} ${event.unit} · ${event.at}`,
        `${event.count} ${event.target} ${nudge.description}`,
        "Nudges",
        { kind: "nudge", view: "nudge", id: nudge.id, date: event.day },
        event.id,
      );
  }
  for (const plan of ledger.capitalPlans) {
    add(
      plan.name,
      "Big expense plan",
      `${plan.targetDate ?? ""} ${plan.initialBudget ?? ""} capitals`,
      "Big Expenses",
      { kind: "capital", view: "capitals", id: plan.id },
    );
    for (const item of plan.items)
      add(
        item.name,
        `${plan.name} · ${item.paid ? "Paid" : "Unpaid"}`,
        `${item.notes ?? ""} ${item.estimatedCost} ${item.actualCost ?? ""} ${item.dueDate ?? ""}`,
        "Big Expenses",
        { kind: "capital", view: "capitals", id: item.id, parentId: plan.id },
      );
  }
  const vehicles = new Map(ledger.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  for (const vehicle of vehicles.values())
    add(
      vehicle.name,
      vehicle.model,
      `${vehicle.plate ?? ""} ${vehicle.notes ?? ""} ${vehicle.type}`,
      "Vehicles",
      { kind: "vehicle", view: "vehicles", id: vehicle.id },
    );
  for (const fill of history.fills)
    add(
      fill.station || "Fill-up",
      `${vehicles.get(fill.vehicleId)?.name ?? "Vehicle"} · ${fill.date} · ${fill.price}`,
      `${fill.quantity} ${fill.odometer ?? ""}`,
      "Vehicles",
      { kind: "fill", view: "vehicles", id: fill.id, parentId: fill.vehicleId, date: fill.date },
    );
  return documents;
}
