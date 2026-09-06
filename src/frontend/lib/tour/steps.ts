import type { ViewId } from "@/frontend/lib/types";
import type { PopperPlacement, StepOptions } from "shepherd.js";

/** Which real Tour action a placeholder step button maps to once runTour binds it. */
type TourButtonKind = "next" | "back" | "complete";

/** A step button before runTour.ts binds `kind` to a real Shepherd `action` handler. */
interface TourStepButton {
  text: string;
  classes: string;
  kind: TourButtonKind;
}

type TourStep = Omit<StepOptions, "buttons"> & { id: string; buttons?: TourStepButton[] };

function navTarget(view: ViewId): string {
  return `[data-tour="tour-nav-${view}"]`;
}

/** Extra mobile hint when a view lives under the More sheet (≤860px). */
function moreNavHint(view: ViewId): string {
  const inMore = new Set<ViewId>([
    "budgets",
    "recurring",
    "vehicles",
    "categories",
    "piggies",
    "capitals",
    "calculator",
    "insights",
    "transparency",
  ]);
  if (!inMore.has(view)) return "";

  return " On phone and tablet, open More in the tab bar first.";
}

function btn(text: string, kind: TourButtonKind): TourStepButton {
  return {
    text,
    classes: kind === "back" ? "shepherd-button-secondary" : "shepherd-button-primary",
    kind,
  };
}

function step(
  id: string,
  title: string,
  text: string,
  element: string,
  on: PopperPlacement = "bottom",
  extra: Partial<TourStep> = {},
): TourStep {
  return {
    id,
    title,
    text,
    attachTo: { element, on },
    buttons: [btn("Back", "back"), btn("Next", "next")],
    ...extra,
  };
}

function lastStep(
  id: string,
  title: string,
  text: string,
  element: string,
  on: PopperPlacement = "bottom",
): TourStep {
  return step(id, title, text, element, on, {
    buttons: [btn("Back", "back"), btn("Done", "complete")],
  });
}

export const SHELL_TOUR_STEPS: TourStep[] = [
  step(
    "shell-nav",
    "Navigation",
    "Jump between Overview, tasks, schedule, transactions, and more. On desktop, use the sidebar. On phone and tablet, use the five-tab bar at the bottom — Budget, Capitals, Insights, and the rest live under More.",
    ".sidebar .nav, .bottom-nav",
    "right",
  ),
  step(
    "shell-wallet",
    "Wallets",
    "Switch between wallets or open Manage Wallets to set income, currency, and defaults.",
    '[data-tour="tour-wallet"]',
    "bottom",
  ),
  step(
    "shell-month",
    "Month",
    "Most views are scoped to the selected month. Use the arrows or tap the label to pick another month.",
    '[data-tour="tour-month"]',
    "bottom",
  ),
  step(
    "shell-fab",
    "Quick Add",
    "Use the floating button to add a transaction or calendar event from anywhere in the app.",
    '[data-tour="tour-fab"]',
    "top",
  ),
  lastStep(
    "shell-account",
    "Account",
    "Restart this tab's tour anytime from Take a Tour, or replay any view's tour from the ? beside its title. Theme is in the top bar.",
    '[data-tour="tour-account"]',
    "bottom",
  ),
];

const VIEW_STEPS: Record<ViewId, TourStep[]> = {
  overview: [
    step(
      "overview-nav",
      "Overview",
      "Your monthly snapshot — income, spend, savings, and what's left.",
      navTarget("overview"),
      "right",
    ),
    step(
      "overview-summary",
      "Summary Cards",
      "These four cards show your pool, spending, savings, and remaining balance for the month.",
      '[data-tour="tour-overview-summary"]',
    ),
    step(
      "overview-oldest-todo",
      "Recent To-Do",
      "Up to three of your oldest to-do lists — tap to open TO-DO List.",
      '[data-tour="tour-overview-oldest-todo"]',
    ),
    step(
      "overview-today-schedule",
      "Recent Schedule",
      "Up to three remaining events for today, based on the current time when Overview loads.",
      '[data-tour="tour-overview-today-schedule"]',
    ),
    step(
      "overview-trend",
      "Spending & Earning Trend",
      "Track cumulative spending and earning against your total budget as the month progresses. Hover any day to see what you spent and earned, broken down by category.",
      '[data-tour="tour-overview-trend"]',
      "top",
    ),
    step(
      "overview-donut",
      "By Category",
      "Tap or hover slices to see how spending breaks down across categories.",
      '[data-tour="tour-overview-donut"]',
      "left",
    ),
    step(
      "overview-recent",
      "Recent Transaction",
      "Up to three of your latest transactions. Tap one to edit, or View More for the full list.",
      '[data-tour="tour-overview-recent"]',
    ),
    step(
      "overview-piggies",
      "Piggies",
      "Your top savings categories at a glance — tap View More for the full Piggies view.",
      '[data-tour="tour-overview-piggies"]',
    ),
    lastStep(
      "overview-capitals",
      "Capitals",
      "Planning something big — a marriage, a trip, a loan? Capitals tracks a total budget, paid progress, what is still unspent from the savings you assigned to it, and a monthly save amount toward your target date." +
        moreNavHint("capitals"),
      navTarget("capitals"),
      "right",
    ),
  ],
  todos: [
    step(
      "todos-nav",
      "TO-DO List",
      "Organize tasks into separate lists — groceries, work, travel, and more.",
      navTarget("todos"),
      "right",
    ),
    step(
      "todos-summary",
      "List Stats",
      "Quick counts for lists, total tasks, and completed items.",
      '[data-tour="tour-todos-summary"]',
    ),
    step(
      "todos-toolbar",
      "New List",
      "Create a named list with an icon to keep tasks grouped.",
      '[data-tour="tour-todos-toolbar"]',
      "bottom",
    ),
    step(
      "todos-tabs",
      "Switch Lists",
      "Each tab is a list. The badge shows completed vs total tasks. Create a list first if you have none yet.",
      '[data-tour="tour-todos-tabs"]',
    ),
    lastStep(
      "todos-tasks",
      "Tasks",
      "Check items off, add new tasks at the bottom, or edit the list with the icons above.",
      '[data-tour="tour-todos-tasks"]',
    ),
  ],
  schedule: [
    step(
      "schedule-nav",
      "Schedule",
      "Plan events and reminders on a calendar tied to your selected month.",
      navTarget("schedule"),
      "right",
    ),
    step(
      "schedule-summary",
      "At a Glance",
      "See how many events you have, the next reminder, and email alerts queued.",
      '[data-tour="tour-schedule-summary"]',
    ),
    step(
      "schedule-cal",
      "Calendar",
      "Click a day to focus it in the agenda below. Click an event chip to edit.",
      '[data-tour="tour-schedule-cal"]',
      "top",
    ),
    lastStep(
      "schedule-agenda",
      "Agenda",
      "Browse day by day, add events with New Event (optional email reminders — a reminder always fires at the event itself too), and review what's coming up.",
      '[data-tour="tour-schedule-agenda"]',
    ),
  ],
  transactions: [
    step(
      "transactions-nav",
      "Transactions",
      "Every expense and income entry for the month, grouped by day — newest first, including by entry time on the same date.",
      navTarget("transactions"),
      "right",
    ),
    step(
      "transactions-search",
      "Search",
      "Filter by note text or category name to find a specific entry.",
      '[data-tour="tour-txn-toolbar"]',
    ),
    step(
      "transactions-filters",
      "Category Filters",
      "Narrow the list to one category or income only.",
      '[data-tour="tour-txn-filters"]',
    ),
    lastStep(
      "transactions-list",
      "Entries",
      "Transactions are grouped by date. Tap a row to edit; deletes ask you to confirm first.",
      '[data-tour="tour-txn-list"]',
    ),
  ],
  budgets: [
    step(
      "budgets-nav",
      "Budgets",
      "Set how much you plan to spend in each category for the month." + moreNavHint("budgets"),
      navTarget("budgets"),
      "right",
    ),
    step(
      "budgets-summary",
      "Totals",
      "Total budget, amount spent so far, and what's left to allocate.",
      '[data-tour="tour-budgets-summary"]',
    ),
    lastStep(
      "budgets-list",
      "Per Category",
      "Tap an amount to edit a category budget. Progress bars show spend vs limit.",
      '[data-tour="tour-budgets-list"]',
    ),
  ],
  calculator: [
    step(
      "calculator-nav",
      "Calculator",
      "Plan budgets from income after custom tax deductions." + moreNavHint("calculator"),
      navTarget("calculator"),
      "right",
    ),
    step(
      "calculator-summary",
      "Totals",
      "Gross income, tax taken, and net left to allocate across categories.",
      '[data-tour="tour-calculator-summary"]',
    ),
    step(
      "calculator-income",
      "Income",
      "Set the gross amount to plan from — it stays on this screen only until you apply budgets.",
      '[data-tour="tour-calculator-income"]',
    ),
    step(
      "calculator-tax",
      "Tax Lines",
      "Add titled percentage deductions — they stay on this screen only.",
      '[data-tour="tour-calculator-tax"]',
    ),
    step(
      "calculator-allocate",
      "Allocate",
      "Toggle Percent or Amount, then fill each expense category until the total is 100% or net after tax.",
      '[data-tour="tour-calculator-allocate"]',
    ),
    lastStep(
      "calculator-apply",
      "Apply",
      "Confirm to replace all expense category budgets on the active wallet.",
      '[data-tour="tour-calculator-apply"]',
      "top",
    ),
  ],
  categories: [
    step(
      "categories-nav",
      "Categories",
      "Your expense and income taxonomy — categories and subcategories." +
        moreNavHint("categories"),
      navTarget("categories"),
      "right",
    ),
    step(
      "categories-toolbar",
      "Filter & Add",
      "Filter by type or add new expense, savings, and income categories.",
      '[data-tour="tour-categories-toolbar"]',
    ),
    lastStep(
      "categories-tree",
      "Category Tree",
      "Expand categories to manage subcategories, colors, and icons. Built-in and custom categories delete when unused and archive when they have history; transfer archived ones onto another category. Savings categories use the custom date picker for optional deadline goals.",
      '[data-tour="tour-categories-tree"]',
    ),
  ],
  recurring: [
    step(
      "recurring-nav",
      "Recurring",
      "Fixed charges that repeat monthly, quarterly, or yearly." + moreNavHint("recurring"),
      navTarget("recurring"),
      "right",
    ),
    step(
      "recurring-summary",
      "This Month",
      "Total recurring due and the normalized monthly equivalent.",
      '[data-tour="tour-recurring-summary"]',
    ),
    lastStep(
      "recurring-list",
      "Scheduled Items",
      "Tap a row to edit the underlying transaction. Add new ones via Add Transaction with Recurring enabled.",
      '[data-tour="tour-recurring-list"]',
    ),
  ],
  piggies: [
    step(
      "piggies-nav",
      "Piggies",
      "One glance at every savings category and its lifetime balance." + moreNavHint("piggies"),
      navTarget("piggies"),
      "right",
    ),
    step(
      "piggies-summary",
      "Totals",
      "Total saved across every piggy, net flow across piggies and Capitals, savings rate, and your current saving streak. The full Saving Insights read lives on the Insights view.",
      '[data-tour="tour-piggies-summary"]',
    ),
    lastStep(
      "piggies-grid",
      "Piggy Cards",
      "Each card is a savings category — its progress ring, subcategories, and Add / Withdraw actions. Unassigned savings land here; assign deposits to a Capital from Add Transaction.",
      '[data-tour="tour-piggies-grid"]',
    ),
  ],
  capitals: [
    step(
      "capitals-nav",
      "Capitals",
      "Plan for big future expenses — marriage, trips, loans, or anything custom. Set a total budget and a target date to see how much to save each month; assign savings deposits to a plan and paying an item spends them down." +
        moreNavHint("capitals"),
      navTarget("capitals"),
      "right",
    ),
    step(
      "capitals-summary",
      "Totals",
      "Total planned, total paid, what is still unspent of everything set aside, monthly saving and what is still to save across every plan, and how many plans have an upcoming target date.",
      '[data-tour="tour-capitals-summary"]',
    ),
    step(
      "capitals-toolbar",
      "New Plan",
      "Start from a template — marriage, trip, car loan, house loan — or build a fully custom plan. You can set a total budget and optional target date.",
      '[data-tour="tour-capitals-toolbar"]',
      "bottom",
    ),
    lastStep(
      "capitals-grid",
      "Plan Cards",
      "Each card shows paid vs budget on the ring, what is set aside and still unspent, what is still to save, a monthly save hint (or Overpaid), line items, and Log to record a real payment in the ledger. Deleting a plan returns its assigned savings to their envelopes.",
      '[data-tour="tour-capitals-grid"]',
    ),
  ],
  vehicles: [
    step(
      "vehicles-nav",
      "Vehicles",
      "Track fuel or charging costs per vehicle — cars, EVs, bikes, and vans each get their own history and Fuel Insights." +
        moreNavHint("vehicles"),
      navTarget("vehicles"),
      "right",
    ),
    step(
      "vehicles-summary",
      "Totals",
      "Vehicle count, total spend across your fleet, cost per km for the selected vehicle, and when you last logged a fill or charge.",
      '[data-tour="tour-vehicles-summary"]',
    ),
    step(
      "vehicles-grid",
      "Vehicle Cards",
      "Tap a card to select it. EVs automatically switch every label to kWh, charge, and kWh/100km.",
      '[data-tour="tour-vehicles-grid"]',
    ),
    step(
      "vehicles-log",
      "Fill / Charge Log",
      "Every fill-up or charge for the selected vehicle, with price, quantity, odometer, and an optional Log to record it as a real transaction.",
      '[data-tour="tour-vehicles-log"]',
    ),
    lastStep(
      "vehicles-insights",
      "Fuel Insights",
      "Consumption trend, price timing, running cost projection, and cadence — generated once a vehicle has enough fill history.",
      '[data-tour="tour-vehicles-insights"]',
      "top",
    ),
  ],
  insights: [
    step(
      "insights-nav",
      "Insights",
      "Longer-range trends, comparisons, and currency views." + moreNavHint("insights"),
      navTarget("insights"),
      "right",
    ),
    step(
      "insights-fx",
      "Currency View",
      "Preview amounts in another currency using live exchange rates.",
      '[data-tour="tour-insights-fx"]',
    ),
    step(
      "insights-standout",
      "What Stands Out",
      "A ranked feed of forecasts, budget risk, and anomalies — generated from your spending, not just described after the fact.",
      '[data-tour="tour-insights-standout"]',
    ),
    step(
      "insights-habits",
      "Spending Habit",
      "After five transaction days, see your month or year spending style — clockwork, burst, dripper, and more.",
      '[data-tour="tour-insights-habits"]',
    ),
    step(
      "insights-chart",
      "Month Over Month",
      "Switch between daily, monthly, quarterly, and yearly bars. Hover a bar for its total spend and income, or tap it to jump to that period.",
      '[data-tour="tour-insights-chart"]',
      "top",
    ),
    step(
      "insights-trends",
      "Breakdowns",
      "Category trends vs last month and your top subcategories this month.",
      '[data-tour="tour-insights-trends"]',
    ),
    lastStep(
      "insights-income",
      "Income",
      "The same read on money coming in — trends by source, how it compares to last month, and how much you kept.",
      '[data-tour="tour-insights-income"]',
      "top",
    ),
  ],
  transparency: [
    step(
      "transparency-nav",
      "Transparency",
      "A read-only map of how Custos stores your data in MongoDB." + moreNavHint("transparency"),
      navTarget("transparency"),
      "right",
    ),
    step(
      "transparency-intro",
      "How Data is Stored",
      "Collections, document keys, and which fields are encrypted vs plaintext for reminders and queries.",
      '[data-tour="tour-transparency-intro"]',
    ),
    step(
      "transparency-infer",
      "What the Server Can Infer",
      "Plaintext metadata, budget-alert amounts, reminder copies, and what stays ciphertext on the server.",
      '[data-tour="tour-transparency-infer"]',
    ),
    step(
      "transparency-flow",
      "Relationships",
      "See how your wallet address links users, wallets, expenses, events, and more.",
      '[data-tour="tour-transparency-flow"]',
    ),
    step(
      "transparency-e2ee",
      "Encryption Path",
      "Ledger secrets are AES-256-GCM encrypted in the browser before they hit the database.",
      '[data-tour="tour-transparency-e2ee"]',
    ),
    lastStep(
      "transparency-collections",
      "Keys & Values",
      "Browse every collection and the document fields it saves.",
      '[data-tour="tour-transparency-collections"]',
    ),
  ],
};

export function getViewTourSteps(view: ViewId): TourStep[] {
  return VIEW_STEPS[view];
}
