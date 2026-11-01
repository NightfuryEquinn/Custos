import {
  budgetAlertEmailHtml,
  emailConfigured,
  emailQuotaExceeded,
  sendEmail,
} from "@/api/lib/email";
import { formatMoneyLabel } from "@/api/lib/money";
import { getCollections, getDb } from "@/db";
import type { BudgetAlertItem } from "@/schemas/budget-alert";
import { ObjectId } from "mongodb";

type BudgetAlertSendResult = {
  sent: number;
  skipped: number;
  errors: string[];
};

/** Turn YYYY-MM into a long month label. */
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;

  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

/**
 * Delivers budget-near-limit emails for alerts the client evaluated after
 * decrypting ledger data. Dedupes via budget_alert_logs so each
 * category/level/month notifies once.
 */
export async function sendBudgetAlerts(opts: {
  accountId: string;
  walletId: string;
  walletName?: string;
  month: string;
  alerts: BudgetAlertItem[];
}): Promise<BudgetAlertSendResult> {
  const result: BudgetAlertSendResult = { sent: 0, skipped: 0, errors: [] };

  if (!emailConfigured()) {
    result.errors.push("RESEND_API_KEY not configured");

    return result;
  }

  const { users, budgetAlertLogs } = getCollections(getDb());
  const user = await users.findOne(
    { _id: new ObjectId(opts.accountId) },
    { projection: { budgetAlertsEnabled: 1, notifyEmail: 1 } },
  );
  if (!user) {
    result.errors.push("User not found");

    return result;
  }

  const emailOn = user.budgetAlertsEnabled !== false;
  const email = user.notifyEmail?.trim() || "";

  if (!emailOn || !email) {
    result.skipped += opts.alerts.length;

    return result;
  }

  const walletName = opts.walletName;
  const label = monthLabel(opts.month);

  /* Prefetch this month's logs for the wallet to avoid per-alert findOne. */
  const existingLogs = await budgetAlertLogs
    .find({
      accountId: opts.accountId,
      walletId: opts.walletId,
      month: opts.month,
    })
    .toArray();
  const existingKeys = new Set(existingLogs.map((log) => `${log.categoryId}|${log.level}`));

  for (const alert of opts.alerts) {
    const dedupeKey = `${alert.categoryId}|${alert.level}`;
    if (existingKeys.has(dedupeKey)) {
      result.skipped++;
      continue;
    }

    const percent = Math.round((alert.spent / alert.budget) * 100);
    const spentLabel = formatMoneyLabel(alert.spent, alert.currency);
    const budgetLabel = formatMoneyLabel(alert.budget, alert.currency);

    const { html, text, subject } = budgetAlertEmailHtml({
      categoryName: alert.categoryName,
      level: alert.level,
      spentLabel,
      budgetLabel,
      percent,
      monthLabel: label,
      walletName,
    });
    if (await emailQuotaExceeded(opts.accountId)) {
      console.warn(`[budget-alerts] email quota exceeded for ${opts.accountId}; alert skipped`);
      result.skipped++;
      continue;
    }

    /* Claim before sending: the unique log index lets only one of two racing
       requests through, instead of both emailing then one failing to log. */
    const logId = new ObjectId();
    try {
      await budgetAlertLogs.insertOne({
        _id: logId,
        accountId: opts.accountId,
        walletId: opts.walletId,
        categoryId: alert.categoryId,
        month: opts.month,
        level: alert.level,
        email,
        channels: ["email"],
        sentAt: new Date(),
      });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 11000) {
        result.skipped++;
      } else {
        result.errors.push(`${alert.categoryId}: failed to log send`);
      }
      continue;
    }
    existingKeys.add(dedupeKey);

    const sent = await sendEmail({ to: email, subject, html, text }).catch((err: unknown) => ({
      ok: false as const,
      error: String(err),
    }));

    if (!sent.ok) {
      /* Release the claim so a later request can retry this alert. */
      await budgetAlertLogs.deleteOne({ _id: logId }).catch(() => {
        /* best-effort — worst case this alert stays suppressed for the month */
      });
      result.errors.push(`${alert.categoryId}: ${sent.error}`);
      continue;
    }

    result.sent++;
  }

  return result;
}
