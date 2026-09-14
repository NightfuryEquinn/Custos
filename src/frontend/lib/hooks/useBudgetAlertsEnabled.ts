const BUDGET_ALERTS_ENABLED_KEY = "ledger:budgetAlertsEnabled";

/**
 * Read the cached budget-alerts preference (warm before /users/me resolves).
 * Mirrors the server's own default: unknown/missing means enabled, matching
 * `user.budgetAlertsEnabled !== false` in `src/api/lib/budget-alerts.ts`.
 */
export function readCachedBudgetAlertsEnabled(): boolean {
  try {
    return localStorage.getItem(BUDGET_ALERTS_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Persist the budget-alerts preference locally so it is available synchronously. */
export function writeCachedBudgetAlertsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(BUDGET_ALERTS_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    /* ignore quota / private mode */
  }
}
