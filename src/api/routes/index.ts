import { ensureDb } from "@/api/middleware/db";
import { globalRateLimit } from "@/api/middleware/rate-limit";
import { securityHeaders } from "@/api/middleware/security";
import { Hono } from "hono";
import { authRoutes } from "./auth";
import { budgetAlertsRoutes } from "./budget-alerts";
import { capitalPlansRoutes } from "./capital-plans";
import { categoriesRoutes } from "./categories";
import { consentRoutes } from "./consent";
import { cronRoutes } from "./cron";
import { eventsRoutes } from "./events";
import { expensesRoutes } from "./expenses";
import { fxRoutes } from "./fx";
import { healthRoutes } from "./health";
import { profileRoutes } from "./profile";
import { pushRoutes } from "./push";
import { todoListsRoutes } from "./todo-lists";
import { usersRoutes } from "./users";
import { vehiclesRoutes } from "./vehicles";
import { walletsRoutes } from "./wallets";

export function createApiRoutes() {
  const api = new Hono();

  api.use("*", securityHeaders);
  /* ensureDb before the rate limiter: on a cold isolate isDbConnected() is
     false until the DB connects, so a rate limiter mounted first silently
     used a per-isolate memory bucket that isn't actually shared. */
  api.use("*", ensureDb);
  api.use("*", globalRateLimit);

  api.route("/health", healthRoutes);
  api.route("/auth", authRoutes);
  api.route("/users", usersRoutes);
  api.route("/push", pushRoutes);
  api.route("/profile", profileRoutes);
  api.route("/wallets", walletsRoutes);
  api.route("/categories", categoriesRoutes);
  api.route("/expenses", expensesRoutes);
  api.route("/events", eventsRoutes);
  api.route("/todo-lists", todoListsRoutes);
  api.route("/capital-plans", capitalPlansRoutes);
  api.route("/vehicles", vehiclesRoutes);
  api.route("/consent", consentRoutes);
  api.route("/budget-alerts", budgetAlertsRoutes);
  api.route("/fx", fxRoutes);
  api.route("/cron", cronRoutes);

  return api;
}
