import type { RecurringInterval } from "@/lib/recurring";

export type { RecurringInterval };

export type Expense = {
  id: string;
  walletId: string;
  kind: "expense" | "income";
  date: string;
  sub: string;
  amount: number;
  note: string;
  recurring: RecurringInterval | false;
  /** When the row was first saved (entry time), for same-day ordering. */
  createdAt?: string;
  /** Optional link to a schedule event (plaintext metadata). */
  eventId?: string;
  /** Optional link to a Capitals plan when savings is assigned (plaintext metadata). */
  capitalPlanId?: string;
};

export type FinancialWallet = {
  id: string;
  name: string;
  currency: string;
  fundingMode: "monthly" | "starting";
  income: number;
  startingBalance: number;
  budgets: Budgets;
  isDefault: boolean;
};

export type EventComment = {
  id: string;
  text: string;
  at: string;
};

export type LedgerEvent = {
  id: string;
  title: string;
  catId: string;
  customLabel?: string;
  customGlyph?: string;
  date: string;
  /** Inclusive last covered day of one occurrence; absent = single-day. */
  endDate?: string | null;
  allDay: boolean;
  time: string | null;
  /** End clock time on the last covered day; absent = none set. */
  endTime?: string | null;
  repeat: string;
  exceptDates?: string[];
  until?: string | null;
  notify: boolean;
  lead: string;
  email: string;
  comments: EventComment[];
  /** Optional link to a ledger expense created from this event. */
  expenseId?: string;
  /** Encrypted envelope hold (amounts stay in E2EE payload). */
  budgetHoldEnabled?: boolean;
  budgetHoldAmount?: number;
  budgetHoldCategoryId?: string;
  /** Occurrence dates where a hold was released after payment. */
  budgetHoldReleasedDates?: string[];
};

export type Budgets = Record<string, number>;

export type Account = {
  address: string;
  codename: string;
  injected?: boolean;
};

export type ViewId =
  | "overview"
  | "transactions"
  | "budgets"
  | "calculator"
  | "categories"
  | "schedule"
  | "insights"
  | "recurring"
  | "todos"
  | "piggies"
  | "capitals"
  | "vehicles"
  | "transparency";

export type MonthEntry = {
  key: string;
  year: number;
  m: number;
};

export type Category = {
  id: string;
  name: string;
  color: string;
  glyph: string;
  type?: "expense" | "income" | "savings";
  builtin?: boolean;
  /** Retired: hidden from pickers, still resolvable so history keeps its type. */
  archived?: boolean;
  /** Piggy goal. Meaningful only when type is "savings". */
  target?: number;
  deadline?: string;
  subs: {
    id: string;
    name: string;
    /** Retired subcategory: hidden from pickers, still resolvable for history. */
    archived?: boolean;
    target?: number;
    deadline?: string;
  }[];
};

export type CategoryIndex = import("./categories").CategoryIndex;

export type TodoTask = {
  id: string;
  title: string;
  done: boolean;
};

export type TodoList = {
  id: string;
  name: string;
  icon: string;
  tasks: TodoTask[];
};

export type CapitalTemplateId = "marriage" | "trip" | "car-loan" | "house-loan" | "custom";

export type CapitalItem = {
  id: string;
  name: string;
  estimatedCost: number;
  actualCost?: number;
  paid: boolean;
  /** Set once "log to ledger" creates a real Expense for this item. */
  loggedExpenseId?: string;
  notes?: string;
  dueDate?: string;
};

export type CapitalPlan = {
  id: string;
  name: string;
  templateId?: CapitalTemplateId;
  glyph: string;
  targetDate?: string;
  /** The plan's total target cost. Not money in hand — the pot of savings
   * assigned to the plan is derived from transactions. 0 or absent falls back
   * to the sum of item estimates; see `planEffectiveBudget`. */
  initialBudget?: number;
  createdAt: string;
  items: CapitalItem[];
};

export type VehicleType = "car" | "ev" | "bike" | "van";

export type Vehicle = {
  id: string;
  name: string;
  model: string;
  type: VehicleType;
  plate?: string;
  glyph: string;
  /** Odometer at the point tracking started; anchors the first distance segment. */
  odometerStart?: number;
  /** Litres, or kWh of usable battery on an EV. Enables tank-share hints. */
  tankCapacity?: number;
  notes?: string;
  createdAt: string;
};

export type FuelFill = {
  id: string;
  vehicleId: string;
  date: string;
  /** Total paid, in the active wallet's currency. */
  price: number;
  /** Litres for combustion, kWh for an EV. */
  quantity: number;
  /** Odometer at the fill, in km. Absent when the user skipped it. */
  odometer?: number;
  station: string;
  /** True when the tank/battery was not filled to full — breaks the distance segment. */
  partial: boolean;
  /** Optional link to a Capitals-style ledger expense created via "Log to ledger". */
  expenseId?: string;
};

/** On-device passphrase vault blob (no plaintext keys). `v` selects the PBKDF2
 *  iteration count — see PBKDF2_ITERATIONS_BY_VERSION in device-vault.ts. */
export type IdentityVault = {
  v: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

/** In-memory / migration-only secrets — never persist to localStorage. */
export type LegacyIdentitySecrets = {
  mnemonic: string;
  privateKey: string;
};

export type IdentityRecord = {
  address: string;
  codename?: string;
  /** Encrypted mnemonic + privateKey (in-app wallets). */
  vault?: IdentityVault;
  /**
   * @deprecated ACTIVE MIGRATION — read-only until vaulted; never write to localStorage.
   * Prefer sessionSecrets + vault.
   */
  mnemonic?: string;
  /**
   * @deprecated ACTIVE MIGRATION — read-only until vaulted; never write to localStorage.
   */
  privateKey?: string;
  injected?: boolean;
  lastSeen?: number;
};
