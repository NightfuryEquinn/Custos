import type { CategoryTaxonomy } from "@/schemas/category";
import type { Consent } from "@/schemas/consent";
import type { Event } from "@/schemas/event";
import type { Expense } from "@/schemas/expense";
import type { LedgerProfile } from "@/schemas/profile";
import type { TodoList } from "@/schemas/todo";
import type { User } from "@/schemas/user";
import type { FinancialWallet } from "@/schemas/wallet";
import type { Collection, Db, ObjectId } from "mongodb";

export const COLLECTIONS = {
  users: "users",
  ledgerProfiles: "ledger_profiles",
  financialWallets: "financial_wallets",
  categoryTaxonomies: "category_taxonomies",
  expenses: "expenses",
  events: "events",
  consent: "consent",
  authNonces: "auth_nonces",
  sessions: "sessions",
  reminderLogs: "reminder_logs",
  budgetAlertLogs: "budget_alert_logs",
  pushSubscriptions: "push_subscriptions",
  todoLists: "todo_lists",
  capitalPlans: "capital_plans",
  vehicles: "vehicles",
  vehicleFills: "vehicle_fills",
  rateLimits: "rate_limits",
} as const;

/** Shared rate-limit bucket document (keyed by limit prefix + client key). */
export type RateLimitDocument = {
  _id: string;
  count: number;
  /** Window end — Date so the TTL index can expire stale buckets. */
  resetAt: Date;
};

type UserDocument = Omit<User, "createdAt" | "updatedAt"> & {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

type LedgerProfileDocument = Omit<LedgerProfile, "createdAt" | "updatedAt"> & {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

type FinancialWalletDocument = Omit<FinancialWallet, "createdAt" | "updatedAt"> & {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

type CategoryTaxonomyDocument = Omit<CategoryTaxonomy, "createdAt" | "updatedAt"> & {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Mongo storage shape for expenses.
 * Linked ids are ObjectIds in the DB (serialized to hex strings on read).
 * `recurring: true` is a legacy value still present in older rows.
 */
export type ExpenseDocument = Omit<
  Expense,
  "createdAt" | "updatedAt" | "walletId" | "eventId" | "capitalPlanId" | "recurring" | "skipped"
> & {
  _id: ObjectId;
  walletId?: ObjectId | string;
  eventId?: ObjectId | string;
  capitalPlanId?: ObjectId | string;
  recurring: Expense["recurring"] | true;
  skipped?: boolean;
  /** Cron scan cursor — oldest / never-scanned first. */
  lastScannedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

/** Mongo storage shape for events (`expenseId` stored as ObjectId). */
export type EventDocument = Omit<Event, "createdAt" | "updatedAt" | "expenseId"> & {
  _id: ObjectId;
  expenseId?: ObjectId | string;
  /** Cron scan cursor — oldest / never-scanned first. */
  lastScannedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

type ConsentDocument = Omit<Consent, "createdAt" | "updatedAt"> & {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

type AuthNonceDocument = {
  _id: ObjectId;
  address: string;
  nonce: string;
  message: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
};

export type SessionDocument = {
  _id: ObjectId;
  /** Opaque users._id hex — primary ownership key after cutover. */
  accountId?: string;
  /** Legacy SIWE address; kept for old sessions until backfill. */
  address?: string;
  tokenHash: string;
  /**
   * Previous tokenHash, kept valid briefly after a sliding-renewal rotation.
   * A page load fans out several concurrent requests on the pre-rotation
   * cookie; without this grace window, any request whose lookup lands after
   * a sibling's rotation finds no matching row and 401s.
   */
  prevTokenHash?: string;
  prevTokenValidUntil?: Date;
  userAgent: string;
  ip: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
};

/** Delivery channels a reminder can go out on. */
export type ReminderChannel = "email" | "push";

/**
 * A browser push endpoint registered by one device. Presence of a row is the
 * account's push opt-in; disabling notifications deletes it.
 */
type PushSubscriptionDocument = {
  _id: ObjectId;
  accountId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
  createdAt: Date;
  lastSeenAt: Date;
};

export type ReminderLogDocument = {
  _id: ObjectId;
  accountId: string;
  eventId: ObjectId;
  occurrenceIso: string;
  lead: string;
  email: string;
  /** Channels that succeeded for this occurrence (absent on pre-push rows). */
  channels?: ReminderChannel[];
  sentAt: Date;
};

/** Dedupes budget-near-limit delivery (one per user/wallet/category/month/level). */
type BudgetAlertLogDocument = {
  _id: ObjectId;
  accountId: string;
  /** Legacy ownership key; unset after backfill. */
  userAddress?: string;
  walletId: string;
  categoryId: string;
  month: string;
  level: "warning" | "exceeded";
  email: string;
  channels?: ReminderChannel[];
  sentAt: Date;
};

type TodoListDocument = Omit<TodoList, "createdAt" | "updatedAt"> & {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

type CapitalPlanDocument = {
  _id: ObjectId;
  accountId: string;
  enc: 1;
  payload: string;
  createdAt: Date;
  updatedAt: Date;
};

type VehicleTypeId = "car" | "ev" | "bike" | "van";

type VehicleDocument = {
  _id: ObjectId;
  accountId: string;
  type: VehicleTypeId;
  enc: 1;
  payload: string;
  createdAt: Date;
  updatedAt: Date;
};

type VehicleFillDocument = {
  _id: ObjectId;
  accountId: string;
  vehicleId: ObjectId;
  date: string;
  partial: boolean;
  expenseId?: ObjectId;
  enc: 1;
  payload: string;
  createdAt: Date;
  updatedAt: Date;
};

type Collections = {
  users: Collection<UserDocument>;
  ledgerProfiles: Collection<LedgerProfileDocument>;
  financialWallets: Collection<FinancialWalletDocument>;
  categoryTaxonomies: Collection<CategoryTaxonomyDocument>;
  expenses: Collection<ExpenseDocument>;
  events: Collection<EventDocument>;
  consent: Collection<ConsentDocument>;
  authNonces: Collection<AuthNonceDocument>;
  sessions: Collection<SessionDocument>;
  reminderLogs: Collection<ReminderLogDocument>;
  budgetAlertLogs: Collection<BudgetAlertLogDocument>;
  pushSubscriptions: Collection<PushSubscriptionDocument>;
  todoLists: Collection<TodoListDocument>;
  capitalPlans: Collection<CapitalPlanDocument>;
  vehicles: Collection<VehicleDocument>;
  vehicleFills: Collection<VehicleFillDocument>;
};

/** Get typed collection handles for the connected database. */
export function getCollections(db: Db): Collections {
  return {
    users: db.collection<UserDocument>(COLLECTIONS.users),
    ledgerProfiles: db.collection<LedgerProfileDocument>(COLLECTIONS.ledgerProfiles),
    financialWallets: db.collection<FinancialWalletDocument>(COLLECTIONS.financialWallets),
    categoryTaxonomies: db.collection<CategoryTaxonomyDocument>(COLLECTIONS.categoryTaxonomies),
    expenses: db.collection<ExpenseDocument>(COLLECTIONS.expenses),
    events: db.collection<EventDocument>(COLLECTIONS.events),
    consent: db.collection<ConsentDocument>(COLLECTIONS.consent),
    authNonces: db.collection<AuthNonceDocument>(COLLECTIONS.authNonces),
    sessions: db.collection<SessionDocument>(COLLECTIONS.sessions),
    reminderLogs: db.collection<ReminderLogDocument>(COLLECTIONS.reminderLogs),
    budgetAlertLogs: db.collection<BudgetAlertLogDocument>(COLLECTIONS.budgetAlertLogs),
    pushSubscriptions: db.collection<PushSubscriptionDocument>(COLLECTIONS.pushSubscriptions),
    todoLists: db.collection<TodoListDocument>(COLLECTIONS.todoLists),
    capitalPlans: db.collection<CapitalPlanDocument>(COLLECTIONS.capitalPlans),
    vehicles: db.collection<VehicleDocument>(COLLECTIONS.vehicles),
    vehicleFills: db.collection<VehicleFillDocument>(COLLECTIONS.vehicleFills),
  };
}
