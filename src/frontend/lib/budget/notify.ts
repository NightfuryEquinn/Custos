import { api } from "@/frontend/lib/api";
import { fmtMoney, monthLabel } from "@/frontend/lib/data";
import type { CategoryIndex } from "@/frontend/lib/categories";
import type { Budgets, Expense, FinancialWallet, LedgerEvent } from "@/frontend/lib/types";
import { budgetAlertDedupeKey, evaluateBudgetAlerts, type BudgetAlert } from "@/lib/budget-alerts";
import { monthStats } from "@/frontend/lib/stats";
import { readCachedBudgetAlertsEnabled } from "@/frontend/lib/hooks/useBudgetAlertsEnabled";
import { readCachedNotifyEmail } from "@/frontend/lib/hooks/useAccountNotifyEmail";

const LOCAL_SENT_KEY = "ledger:budget-alerts-sent";

/** Read previously sent alert dedupe keys from localStorage. */
function readSentKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(LOCAL_SENT_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

/** Persist newly sent alert dedupe keys, capping growth. */
function markSent(keys: string[]): void {
  try {
    const next = readSentKeys();
    for (const k of keys) next.add(k);
    /* Cap growth — keep the most recent ~200 keys. */
    const list = [...next].slice(-200);
    localStorage.setItem(LOCAL_SENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** Build the notification body for a budget alert. */
function notificationBody(alert: BudgetAlert, currency: string): string {
  const pct = Math.round(alert.ratio * 100);
  const spent = fmtMoney(alert.spent, { cents: false, currency });
  const budget = fmtMoney(alert.budget, { cents: false, currency });
  if (alert.level === "exceeded") {
    return `${spent} of ${budget} — over budget for ${monthLabel(alert.month, true)}`;
  }
  return `${spent} of ${budget} (${pct}% used) for ${monthLabel(alert.month, true)}`;
}

/** Show an in-tab Notification for a budget alert when permission is granted. */
async function showBudgetAlertNotification(alert: BudgetAlert, currency: string): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;

  const title =
    alert.level === "exceeded"
      ? `Budget exceeded: ${alert.categoryName}`
      : `Budget alert: ${alert.categoryName}`;

  try {
    new Notification(title, {
      body: notificationBody(alert, currency),
      tag: budgetAlertDedupeKey({
        walletId: "local",
        categoryId: alert.categoryId,
        month: alert.month,
        level: alert.level,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * After an expense mutation, evaluate category budgets and deliver email alerts.
 * Amounts never leave the client except as already-computed alert summaries.
 * In-tab Notification is a fallback while the app is open.
 */
export async function maybeNotifyBudgetAlerts(opts: {
  expenses: Expense[];
  budgets: Budgets;
  wallet: FinancialWallet;
  month: string;
  currency: string;
  categoryIndex: CategoryIndex;
  events?: LedgerEvent[];
}): Promise<BudgetAlert[]> {
  const st = monthStats(
    opts.expenses,
    opts.budgets,
    opts.wallet,
    opts.month,
    opts.categoryIndex,
    opts.events,
  );
  const alerts = evaluateBudgetAlerts({
    byCat: st.byCat,
    byCatHeld: st.byCatHeld,
    budgets: opts.budgets,
    categories: opts.categoryIndex.spendingCategories,
    month: opts.month,
  });
  if (!alerts.length) return [];

  const sent = readSentKeys();
  const fresh = alerts.filter((a) => {
    const key = budgetAlertDedupeKey({
      walletId: opts.wallet.id,
      categoryId: a.categoryId,
      month: a.month,
      level: a.level,
    });
    return !sent.has(key);
  });
  if (!fresh.length) return [];

  for (const alert of fresh) {
    await showBudgetAlertNotification(alert, opts.currency);
  }

  /*
   * Gate egress on the device's own cached preference *before* building the
   * request — the plaintext wallet/category names and amounts below must
   * never leave the browser when alerts are off or no notify email is set.
   * The server enforces the same rule on receipt (src/api/lib/budget-alerts.ts),
   * but that check runs after the payload has already crossed the network.
   */
  if (readCachedBudgetAlertsEnabled() && readCachedNotifyEmail()) {
    try {
      await api.budgetAlerts.notify({
        walletId: opts.wallet.id,
        walletName: opts.wallet.name,
        month: opts.month,
        alerts: fresh.map((a) => ({
          categoryId: a.categoryId,
          categoryName: a.categoryName,
          spent: a.spent,
          budget: a.budget,
          level: a.level,
          currency: opts.currency,
        })),
      });
    } catch {
      /* Email may be unset or Resend unconfigured — in-tab notification still fired above. */
    }
  }

  markSent(
    fresh.map((a) =>
      budgetAlertDedupeKey({
        walletId: opts.wallet.id,
        categoryId: a.categoryId,
        month: a.month,
        level: a.level,
      }),
    ),
  );

  return fresh;
}
