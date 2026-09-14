import {
  decryptJson,
  encryptJson,
  expenseSeriesKey,
  type CapitalPlanSecrets,
  type CategorySecrets,
  type EventSecrets,
  type ExpenseSecrets,
  type TodoListSecrets,
  type VehicleFillSecrets,
  type VehicleSecrets,
  type WalletSecrets,
} from "@/frontend/lib/crypto/e2ee";
import type {
  Budgets,
  CapitalPlan,
  Category,
  Expense,
  FinancialWallet,
  FuelFill,
  LedgerEvent,
  TodoList,
  Vehicle,
} from "@/frontend/lib/types";
import { normalizeRecurring } from "@/frontend/lib/stats";
import type { RecurringField } from "@/lib/recurring";
import type { ReminderDetails } from "@/schemas/event";

export type ExpenseWire = {
  id: string;
  walletId: string;
  kind: "expense" | "income";
  date: string;
  recurring: RecurringField | false;
  enc?: 1;
  payload?: string;
  seriesKey?: string;
  eventId?: string;
  capitalPlanId?: string;
  /** Legacy plaintext fields (pre-E2EE or migration). */
  sub?: string;
  amount?: number;
  note?: string;
  createdAt?: string;
};

export type WalletWire = Omit<
  FinancialWallet,
  "name" | "income" | "startingBalance" | "budgets"
> & {
  name?: string;
  income?: number;
  startingBalance?: number;
  budgets?: Budgets;
  enc?: 1;
  payload?: string;
};

/** Pass through server metadata that decode merges onto every expense shape. */
function expenseWireMeta(
  wire: ExpenseWire,
): Pick<Expense, "eventId" | "capitalPlanId" | "createdAt"> {
  return {
    ...(wire.eventId ? { eventId: wire.eventId } : {}),
    ...(wire.capitalPlanId ? { capitalPlanId: wire.capitalPlanId } : {}),
    ...(wire.createdAt ? { createdAt: wire.createdAt } : {}),
  };
}

/** Decrypt expense secrets and merge with plaintext metadata. */
export async function decodeExpense(wire: ExpenseWire, key: CryptoKey): Promise<Expense> {
  if (wire.enc === 1 && wire.payload) {
    const secrets = await decryptJson<ExpenseSecrets>(key, wire.payload);
    return {
      id: wire.id,
      walletId: wire.walletId,
      kind: wire.kind ?? "expense",
      date: wire.date,
      recurring: normalizeRecurring(wire.recurring),
      ...expenseWireMeta(wire),
      ...secrets,
    };
  }
  if (wire.sub == null || wire.amount == null) {
    throw new Error("Expense is encrypted but no key is available");
  }
  return {
    id: wire.id,
    walletId: wire.walletId,
    kind: wire.kind ?? "expense",
    date: wire.date,
    sub: wire.sub,
    amount: wire.amount,
    note: wire.note ?? "",
    recurring: normalizeRecurring(wire.recurring),
    ...expenseWireMeta(wire),
  };
}

export async function encodeExpenseCreate(
  expense: Pick<
    Expense,
    | "walletId"
    | "kind"
    | "date"
    | "sub"
    | "amount"
    | "note"
    | "recurring"
    | "eventId"
    | "capitalPlanId"
  >,
  key: CryptoKey,
  seriesHmacKey: CryptoKey,
) {
  const payload = await encryptJson(key, {
    sub: expense.sub,
    amount: expense.amount,
    note: expense.note ?? "",
  } satisfies ExpenseSecrets);
  const recurring = normalizeRecurring(expense.recurring);
  const seriesKey =
    recurring !== false
      ? await expenseSeriesKey(seriesHmacKey, {
          walletId: expense.walletId,
          sub: expense.sub,
          note: expense.note ?? "",
          recurring,
        })
      : undefined;
  return {
    walletId: expense.walletId,
    kind: expense.kind ?? "expense",
    date: expense.date,
    recurring,
    enc: 1 as const,
    payload,
    ...(seriesKey ? { seriesKey } : {}),
    ...(expense.eventId ? { eventId: expense.eventId } : {}),
    ...(expense.capitalPlanId ? { capitalPlanId: expense.capitalPlanId } : {}),
  };
}

export async function encodeExpenseUpdate(
  expense: Partial<Omit<Expense, "id">> & Pick<Expense, "sub" | "amount" | "note">,
  key: CryptoKey,
  seriesHmacKey: CryptoKey,
) {
  const payload = await encryptJson(key, {
    sub: expense.sub,
    amount: expense.amount,
    note: expense.note ?? "",
  } satisfies ExpenseSecrets);
  const patch: Record<string, unknown> = { enc: 1, payload };
  if (expense.walletId) patch.walletId = expense.walletId;
  if (expense.kind) patch.kind = expense.kind;
  if (expense.date) patch.date = expense.date;
  if (expense.eventId !== undefined) patch.eventId = expense.eventId || null;
  if (expense.capitalPlanId !== undefined) patch.capitalPlanId = expense.capitalPlanId || null;
  if (expense.recurring !== undefined) {
    patch.recurring = normalizeRecurring(expense.recurring);
    const recurring = patch.recurring as RecurringField | false;
    if (recurring === false) {
      patch.seriesKey = null;
    } else if (expense.walletId) {
      patch.seriesKey = await expenseSeriesKey(seriesHmacKey, {
        walletId: expense.walletId,
        sub: expense.sub,
        note: expense.note ?? "",
        recurring,
      });
    }
    /* If walletId is omitted, leave seriesKey untouched so we do not wipe/fork the series. */
  }
  return patch;
}

/** Decrypt wallet secrets (name + financials), with legacy plaintext fallback. */
export async function decodeWallet(wire: WalletWire, key: CryptoKey): Promise<FinancialWallet> {
  if (wire.enc === 1 && wire.payload) {
    const secrets = await decryptJson<Partial<WalletSecrets> & { income?: number }>(
      key,
      wire.payload,
    );

    return {
      id: wire.id,
      name: secrets.name ?? wire.name ?? "Wallet",
      currency: wire.currency,
      fundingMode: wire.fundingMode ?? "monthly",
      isDefault: wire.isDefault,
      income: secrets.income ?? 0,
      startingBalance: secrets.startingBalance ?? 0,
      budgets: secrets.budgets ?? {},
    };
  }

  return {
    id: wire.id,
    name: wire.name ?? "Wallet",
    currency: wire.currency,
    fundingMode: wire.fundingMode ?? "monthly",
    income: wire.income ?? 0,
    startingBalance: wire.startingBalance ?? 0,
    budgets: wire.budgets ?? {},
    isDefault: wire.isDefault,
  };
}

/** Encrypt wallet name and financial fields for create/update. */
export async function encodeWalletFinancials(
  data: { name: string; income?: number; startingBalance?: number; budgets?: Budgets },
  key: CryptoKey,
) {
  return {
    enc: 1 as const,
    payload: await encryptJson(key, {
      name: data.name,
      income: data.income ?? 0,
      startingBalance: data.startingBalance ?? 0,
      budgets: data.budgets ?? {},
    } satisfies WalletSecrets),
  };
}

export type CategoriesWire = {
  enc?: 1;
  payload?: string;
  /** Legacy plaintext tree (pre-E2EE). */
  categories?: Category[];
  /** No taxonomy doc yet — client should seed encrypted defaults. */
  seed?: boolean;
};

/** Decrypt category taxonomy wire, or return legacy plaintext categories. */
export async function decodeCategories(wire: CategoriesWire, key: CryptoKey): Promise<Category[]> {
  if (wire.enc === 1 && wire.payload) {
    const secrets = await decryptJson<CategorySecrets>(key, wire.payload);

    return secrets.categories;
  }

  if (wire.categories) return wire.categories;

  throw new Error("Category taxonomy is encrypted but no key is available");
}

/** Encrypt the full category tree for PUT /api/categories. */
export async function encodeCategories(categories: Category[], key: CryptoKey) {
  return {
    enc: 1 as const,
    payload: await encryptJson(key, { categories } satisfies CategorySecrets),
  };
}

/** Wallet currency + resolved hold category name, needed for email copy. */
export type ReminderContext = {
  currency?: string;
  holdCategoryName?: string;
};

export type EventWire = {
  id: string;
  catId: LedgerEvent["catId"];
  date: string;
  endDate?: string | null;
  allDay: boolean;
  time: string | null;
  endTime?: string | null;
  repeat: LedgerEvent["repeat"];
  exceptDates?: string[];
  until?: string | null;
  notify: boolean;
  lead: LedgerEvent["lead"];
  email?: string;
  expenseId?: string;
  enc?: 1;
  payload?: string;
  /** Plaintext copy the server renders into reminder emails. */
  notifyDetails?: ReminderDetails;
  /** Legacy plaintext secrets. */
  title?: string;
  comments?: LedgerEvent["comments"];
  customLabel?: string;
  customGlyph?: string;
};

/** Merge encrypted hold fields onto a decoded event. */
function mergeEventHoldSecrets(event: LedgerEvent, secrets: EventSecrets): LedgerEvent {
  const next = { ...event };

  if (secrets.budgetHoldEnabled) {
    const amount = Number(secrets.budgetHoldAmount);
    next.budgetHoldEnabled = true;
    next.budgetHoldAmount = Number.isFinite(amount) ? amount : undefined;
    next.budgetHoldCategoryId = secrets.budgetHoldCategoryId;
    next.budgetHoldReleasedDates = secrets.budgetHoldReleasedDates;
  } else {
    delete next.budgetHoldEnabled;
    delete next.budgetHoldAmount;
    delete next.budgetHoldCategoryId;
    delete next.budgetHoldReleasedDates;
  }

  return next;
}

/** Copy hold fields from a ledger event into encrypted secrets. */
function eventHoldSecrets(event: Partial<LedgerEvent>): Partial<EventSecrets> {
  if (!event.budgetHoldEnabled) return { budgetHoldEnabled: false };

  const amount = Number(event.budgetHoldAmount);
  const secrets: Partial<EventSecrets> = {
    budgetHoldEnabled: true,
    budgetHoldCategoryId: event.budgetHoldCategoryId,
  };

  if (Number.isFinite(amount) && amount > 0) {
    secrets.budgetHoldAmount = amount;
  }

  if (event.budgetHoldReleasedDates?.length) {
    secrets.budgetHoldReleasedDates = event.budgetHoldReleasedDates;
  }

  return secrets;
}

/** Field limits mirroring `reminderDetailsSchema` so a save is never rejected. */
const REMINDER_TITLE_MAX = 200;
const REMINDER_COMMENT_MAX = 500;
const REMINDER_COMMENTS_MAX = 20;
const REMINDER_CATEGORY_MAX = 64;

/**
 * Plaintext copy of the event content that reminder emails render (name, budget
 * hold, comments). Only built while an email reminder is configured — the email
 * body is plaintext anyway, so the server needs a readable copy to send it.
 */
export function buildReminderDetails(
  event: Partial<LedgerEvent>,
  ctx?: ReminderContext,
): ReminderDetails | null {
  const title = (event.title ?? "").trim().slice(0, REMINDER_TITLE_MAX);
  if (!event.notify || !title) return null;

  const details: ReminderDetails = { title };

  const holdAmount = Number(event.budgetHoldAmount);
  if (event.budgetHoldEnabled && Number.isFinite(holdAmount) && holdAmount > 0) {
    const categoryName = ctx?.holdCategoryName?.trim().slice(0, REMINDER_CATEGORY_MAX);
    details.hold = {
      amount: holdAmount,
      ...(ctx?.currency?.length === 3 ? { currency: ctx.currency } : {}),
      ...(categoryName ? { categoryName } : {}),
    };
  }

  const comments = (event.comments ?? [])
    .map((c) => c.text.trim().slice(0, REMINDER_COMMENT_MAX))
    .filter(Boolean)
    .slice(-REMINDER_COMMENTS_MAX);
  if (comments.length) details.comments = comments;

  return details;
}

/** Decrypt event secrets and merge with plaintext schedule metadata. */
export async function decodeEvent(wire: EventWire, key: CryptoKey): Promise<LedgerEvent> {
  if (wire.enc === 1 && wire.payload) {
    const secrets = await decryptJson<EventSecrets>(key, wire.payload);

    return mergeEventHoldSecrets(
      {
        id: wire.id,
        catId: wire.catId,
        date: wire.date,
        endDate: wire.endDate ?? null,
        allDay: wire.allDay,
        time: wire.time,
        endTime: wire.endTime ?? null,
        repeat: wire.repeat,
        exceptDates: wire.exceptDates,
        until: wire.until,
        notify: wire.notify,
        lead: wire.lead,
        email: wire.email ?? "",
        ...(wire.expenseId ? { expenseId: wire.expenseId } : {}),
        title: secrets.title,
        comments: secrets.comments ?? [],
        ...(secrets.customLabel ? { customLabel: secrets.customLabel } : {}),
        ...(secrets.customGlyph ? { customGlyph: secrets.customGlyph } : {}),
      },
      secrets,
    );
  }

  if (wire.title == null) {
    throw new Error("Event is encrypted but no key is available");
  }

  return {
    id: wire.id,
    title: wire.title,
    catId: wire.catId,
    customLabel: wire.customLabel,
    customGlyph: wire.customGlyph,
    date: wire.date,
    endDate: wire.endDate ?? null,
    allDay: wire.allDay,
    time: wire.time,
    endTime: wire.endTime ?? null,
    repeat: wire.repeat,
    exceptDates: wire.exceptDates,
    until: wire.until,
    notify: wire.notify,
    lead: wire.lead,
    email: wire.email ?? "",
    comments: wire.comments ?? [],
    ...(wire.expenseId ? { expenseId: wire.expenseId } : {}),
  };
}

/** Build encrypted create body for an event (secrets in payload). */
export async function encodeEventCreate(
  event: Omit<LedgerEvent, "id">,
  key: CryptoKey,
  ctx?: ReminderContext,
) {
  const secrets: EventSecrets = {
    title: event.title,
    comments: event.comments ?? [],
    ...eventHoldSecrets(event),
  };
  if (event.catId === "custom") {
    if (event.customLabel) secrets.customLabel = event.customLabel;
    if (event.customGlyph) secrets.customGlyph = event.customGlyph;
  }

  const notifyDetails = buildReminderDetails(event, ctx);

  return {
    catId: event.catId,
    date: event.date,
    endDate: event.endDate ?? null,
    allDay: event.allDay,
    time: event.time,
    endTime: event.endTime ?? null,
    repeat: event.repeat,
    notify: event.notify,
    lead: event.lead,
    email: event.email ?? "",
    ...(notifyDetails ? { notifyDetails } : {}),
    ...(event.expenseId ? { expenseId: event.expenseId } : {}),
    enc: 1 as const,
    payload: await encryptJson(key, secrets),
  };
}

/** Build encrypted update body for an event. */
export async function encodeEventUpdate(
  event: Partial<Omit<LedgerEvent, "id">> & Pick<LedgerEvent, "title" | "comments">,
  key: CryptoKey,
  ctx?: ReminderContext,
) {
  const secrets: EventSecrets = {
    title: event.title,
    comments: event.comments ?? [],
    ...eventHoldSecrets(event),
  };
  if (event.catId === "custom") {
    if (event.customLabel) secrets.customLabel = event.customLabel;
    if (event.customGlyph) secrets.customGlyph = event.customGlyph;
  }

  const patch: Record<string, unknown> = {
    enc: 1,
    payload: await encryptJson(key, secrets),
  };

  if (event.catId !== undefined) patch.catId = event.catId;
  if (event.date !== undefined) patch.date = event.date;
  if (event.endDate !== undefined) patch.endDate = event.endDate;
  if (event.allDay !== undefined) patch.allDay = event.allDay;
  if (event.time !== undefined) patch.time = event.time;
  if (event.endTime !== undefined) patch.endTime = event.endTime;
  if (event.repeat !== undefined) patch.repeat = event.repeat;
  if (event.exceptDates !== undefined) patch.exceptDates = event.exceptDates;
  if (event.until !== undefined) patch.until = event.until;
  if (event.notify !== undefined) patch.notify = event.notify;
  if (event.lead !== undefined) patch.lead = event.lead;
  if (event.email !== undefined) patch.email = event.email;
  if (event.expenseId !== undefined) patch.expenseId = event.expenseId || null;
  /* `null` clears any copy stored while reminders were on. */
  patch.notifyDetails = buildReminderDetails(event, ctx);

  return patch;
}

export type TodoListWire = {
  id: string;
  enc?: 1;
  payload?: string;
  /** Legacy plaintext fields. */
  name?: string;
  icon?: string;
  tasks?: TodoList["tasks"];
};

/** Decrypt a todo list wire, or return legacy plaintext fields. */
export async function decodeTodoList(wire: TodoListWire, key: CryptoKey): Promise<TodoList> {
  if (wire.enc === 1 && wire.payload) {
    const secrets = await decryptJson<TodoListSecrets>(key, wire.payload);

    return {
      id: wire.id,
      name: secrets.name,
      icon: secrets.icon,
      tasks: secrets.tasks ?? [],
    };
  }

  if (wire.name == null) {
    throw new Error("Todo list is encrypted but no key is available");
  }

  return {
    id: wire.id,
    name: wire.name,
    icon: wire.icon ?? "📋",
    tasks: wire.tasks ?? [],
  };
}

/** Encrypt todo list secrets for create. */
export async function encodeTodoListCreate(
  data: Pick<TodoList, "name" | "icon"> & { tasks?: TodoList["tasks"] },
  key: CryptoKey,
) {
  return {
    enc: 1 as const,
    payload: await encryptJson(key, {
      name: data.name,
      icon: data.icon,
      tasks: data.tasks ?? [],
    } satisfies TodoListSecrets),
  };
}

/** Encrypt todo list secrets for update. */
export async function encodeTodoListUpdate(
  data: Pick<TodoList, "name" | "icon" | "tasks">,
  key: CryptoKey,
) {
  return {
    enc: 1 as const,
    payload: await encryptJson(key, {
      name: data.name,
      icon: data.icon,
      tasks: data.tasks ?? [],
    } satisfies TodoListSecrets),
  };
}

export type CapitalPlanWire = {
  id: string;
  enc?: 1;
  payload?: string;
};

/** Decrypt a capital plan wire. Capitals is E2EE-only — no legacy plaintext branch. */
export async function decodeCapitalPlan(
  wire: CapitalPlanWire,
  key: CryptoKey,
): Promise<CapitalPlan> {
  if (wire.enc !== 1 || !wire.payload) {
    throw new Error("Capital plan is encrypted but no key is available");
  }
  const secrets = await decryptJson<CapitalPlanSecrets>(key, wire.payload);

  return {
    id: wire.id,
    name: secrets.name,
    templateId: secrets.templateId as CapitalPlan["templateId"],
    glyph: secrets.glyph,
    targetDate: secrets.targetDate,
    initialBudget: secrets.initialBudget,
    createdAt: secrets.createdAt,
    items: secrets.items,
  };
}

function capitalPlanSecrets(data: Omit<CapitalPlan, "id">): CapitalPlanSecrets {
  return {
    name: data.name,
    templateId: data.templateId,
    glyph: data.glyph,
    targetDate: data.targetDate,
    initialBudget: data.initialBudget,
    createdAt: data.createdAt,
    items: data.items,
  };
}

/** Encrypt capital plan secrets for create. */
export async function encodeCapitalPlanCreate(data: Omit<CapitalPlan, "id">, key: CryptoKey) {
  return {
    enc: 1 as const,
    payload: await encryptJson(key, capitalPlanSecrets(data)),
  };
}

/** Encrypt capital plan secrets for update. */
export async function encodeCapitalPlanUpdate(data: Omit<CapitalPlan, "id">, key: CryptoKey) {
  return {
    enc: 1 as const,
    payload: await encryptJson(key, capitalPlanSecrets(data)),
  };
}

export type VehicleWire = {
  id: string;
  type: Vehicle["type"];
  createdAt: string;
  enc?: 1;
  payload?: string;
};

/** Decrypt a vehicle wire. Vehicles is E2EE-only — no legacy plaintext branch. */
export async function decodeVehicle(wire: VehicleWire, key: CryptoKey): Promise<Vehicle> {
  if (wire.enc !== 1 || !wire.payload) {
    throw new Error("Vehicle is encrypted but no key is available");
  }
  const secrets = await decryptJson<VehicleSecrets>(key, wire.payload);

  return {
    id: wire.id,
    type: wire.type,
    createdAt: wire.createdAt,
    name: secrets.name,
    model: secrets.model,
    plate: secrets.plate,
    glyph: secrets.glyph,
    odometerStart: secrets.odometerStart,
    tankCapacity: secrets.tankCapacity,
    notes: secrets.notes,
  };
}

function vehicleSecrets(data: Omit<Vehicle, "id" | "createdAt">): VehicleSecrets {
  return {
    name: data.name,
    model: data.model,
    plate: data.plate,
    glyph: data.glyph,
    odometerStart: data.odometerStart,
    tankCapacity: data.tankCapacity,
    notes: data.notes,
  };
}

/** Encrypt vehicle secrets for create. */
export async function encodeVehicleCreate(data: Omit<Vehicle, "id" | "createdAt">, key: CryptoKey) {
  return {
    type: data.type,
    enc: 1 as const,
    payload: await encryptJson(key, vehicleSecrets(data)),
  };
}

/** Encrypt vehicle secrets for update. */
export async function encodeVehicleUpdate(data: Omit<Vehicle, "id" | "createdAt">, key: CryptoKey) {
  return {
    type: data.type,
    enc: 1 as const,
    payload: await encryptJson(key, vehicleSecrets(data)),
  };
}

export type VehicleFillWire = {
  id: string;
  vehicleId: string;
  date: string;
  partial: boolean;
  expenseId?: string;
  enc?: 1;
  payload?: string;
};

/** Decrypt a fuel fill wire. Fills are E2EE-only — no legacy plaintext branch. */
export async function decodeVehicleFill(wire: VehicleFillWire, key: CryptoKey): Promise<FuelFill> {
  if (wire.enc !== 1 || !wire.payload) {
    throw new Error("Fill is encrypted but no key is available");
  }
  const secrets = await decryptJson<VehicleFillSecrets>(key, wire.payload);

  return {
    id: wire.id,
    vehicleId: wire.vehicleId,
    date: wire.date,
    partial: wire.partial,
    expenseId: wire.expenseId,
    price: secrets.price,
    quantity: secrets.quantity,
    odometer: secrets.odometer,
    station: secrets.station,
  };
}

function vehicleFillSecrets(data: Omit<FuelFill, "id">): VehicleFillSecrets {
  return {
    price: data.price,
    quantity: data.quantity,
    odometer: data.odometer,
    station: data.station,
  };
}

/** Encrypt fuel fill secrets for create. */
export async function encodeVehicleFillCreate(data: Omit<FuelFill, "id">, key: CryptoKey) {
  return {
    vehicleId: data.vehicleId,
    date: data.date,
    partial: data.partial,
    ...(data.expenseId ? { expenseId: data.expenseId } : {}),
    enc: 1 as const,
    payload: await encryptJson(key, vehicleFillSecrets(data)),
  };
}

/** Encrypt fuel fill secrets for update. */
export async function encodeVehicleFillUpdate(data: Omit<FuelFill, "id">, key: CryptoKey) {
  return {
    vehicleId: data.vehicleId,
    date: data.date,
    partial: data.partial,
    expenseId: data.expenseId ?? null,
    enc: 1 as const,
    payload: await encryptJson(key, vehicleFillSecrets(data)),
  };
}
