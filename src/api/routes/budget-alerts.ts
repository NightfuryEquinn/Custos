import { sendBudgetAlerts } from "@/api/lib/budget-alerts";
import { badRequest, notFound } from "@/api/lib/errors";
import { rateLimit } from "@/api/middleware/rate-limit";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb } from "@/db";
import { createBudgetAlertsSchema } from "@/schemas/budget-alert";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ObjectId } from "mongodb";

export const budgetAlertsRoutes = new Hono<{ Variables: SessionVariables }>();

/**
 * Client-evaluated budget alerts (amounts stay E2EE). The server only delivers
 * email using the posted alert summaries and dedupes per category/month/level.
 */
budgetAlertsRoutes.post(
  "/",
  sessionAuth,
  /* Each request can send up to 32 emails to an unverified address. */
  rateLimit({
    keyPrefix: "budget-alerts",
    limit: 20,
    windowMs: 60 * 60_000,
    keyFn: (c) => c.get("accountId"),
  }),
  zValidator("json", createBudgetAlertsSchema),
  async (c) => {
    const accountId = c.get("accountId");
    const body = c.req.valid("json");
    const { financialWallets } = getCollections(getDb());

    const wallet = await financialWallets.findOne({
      _id: new ObjectId(body.walletId),
      accountId,
    });
    if (!wallet) notFound("Wallet not found");

    /* Reject obviously inconsistent ratios so a buggy client cannot spam emails. */
    for (const alert of body.alerts) {
      const ratio = alert.spent / alert.budget;
      if (alert.level === "warning" && (ratio < 0.5 || ratio >= 1.0001)) {
        badRequest("Warning alert ratio out of range");
      }
      if (alert.level === "exceeded" && ratio < 0.99) {
        badRequest("Exceeded alert ratio out of range");
      }
    }

    const result = await sendBudgetAlerts({
      accountId,
      walletId: body.walletId,
      walletName: body.walletName,
      month: body.month,
      alerts: body.alerts,
    });

    return c.json({ ok: true, ...result });
  },
);
