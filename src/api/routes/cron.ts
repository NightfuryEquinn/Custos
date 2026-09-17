import { broadcastPush, pushConfigured } from "@/api/lib/push";
import { processDueRecurringExpenses } from "@/api/lib/recurring-expenses";
import { processDueReminders } from "@/api/lib/reminders";
import { ensureDb } from "@/api/middleware/db";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const cronRoutes = new Hono();

cronRoutes.use("*", ensureDb);

/** Constant-time compare of the Authorization header to `Bearer ${CRON_SECRET}`. */
function assertCronAuth(authHeader: string | undefined): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    /* Config disclosure guard: an unauthenticated caller must not learn the
       deploy is misconfigured. Same 401 as a bad token, logged separately. */
    console.error("CRON_SECRET not configured");
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(authHeader ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
}

/**
 * External cron (cron-job.org every ~15 min, or manual curl) — scans the database
 * for due event reminder emails and materializes recurring expense rows.
 */
cronRoutes.get("/reminders", async (c) => {
  assertCronAuth(c.req.header("Authorization"));
  const [reminders, recurring] = await Promise.all([
    processDueReminders(),
    processDueRecurringExpenses(),
  ]);

  return c.json({ ok: true, reminders, recurring });
});

const notifyReleaseSchema = z.object({
  version: z.string().min(1).max(20),
});

/**
 * Called by CI right after a successful production deploy — broadcasts a Web
 * Push notification to every subscribed device that a new version shipped.
 * Not per-account; this is the release channel, not the reminder channel.
 */
cronRoutes.post("/notify-release", async (c) => {
  assertCronAuth(c.req.header("Authorization"));
  if (!pushConfigured())
    return c.json({ ok: true, sent: 0, errors: ["VAPID keys not configured"] });

  const { version } = notifyReleaseSchema.parse(await c.req.json());
  const result = await broadcastPush({
    title: "Custos updated",
    body: `Version ${version} is live. Tap to see what's new.`,
    tag: "release-notify",
    url: "/",
  });

  return c.json({ ok: true, ...result });
});
