import { getDb } from "@/db";
import { Hono } from "hono";

/**
 * Liveness/readiness check that actually exercises the function + Mongo,
 * unlike `GET /` (the static SPA shell). Mounted before `ensureDb` fails
 * closed with 503, so reaching the handler already proves the DB is up;
 * the ping just confirms the connection is still live, not just present.
 */
export const healthRoutes = new Hono();

healthRoutes.get("/", async (c) => {
  await getDb().command({ ping: 1 });
  return c.json({ ok: true });
});
