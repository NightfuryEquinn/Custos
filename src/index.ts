import { createApiApp } from "@/api";
import { processDueRecurringExpenses } from "@/api/lib/recurring-expenses";
import { processDueReminders } from "@/api/lib/reminders";
import { connectDb, isDbConnected } from "@/db/client";
import { REMINDER_POLL_INTERVAL_MS } from "@/lib/schedule";
import { serve } from "bun";
import index from "./index.html";

const api = createApiApp();

try {
  await connectDb();
  console.log("MongoDB connected");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  console.error("API routes will fail until MongoDB is available.");
}

const server = serve({
  routes: {
    "/api/*": (req) => api.fetch(req),
    "/manifest.webmanifest": () =>
      new Response(Bun.file("public/manifest.webmanifest"), {
        headers: { "Content-Type": "application/manifest+json" },
      }),
    "/sw.js": () =>
      new Response(Bun.file("public/sw.js"), {
        headers: { "Content-Type": "application/javascript", "Service-Worker-Allowed": "/" },
      }),
    "/sitemap.xml": () =>
      new Response(Bun.file("public/sitemap.xml"), {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      }),
    "/robots.txt": () =>
      new Response(Bun.file("public/robots.txt"), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`Server running at ${server.url}`);

if (process.env.NODE_ENV !== "production" && process.env.CRON_SECRET?.trim()) {
  const poll = async () => {
    try {
      if (!isDbConnected()) await connectDb();
      /* Either channel alone is enough — push works without Resend. */
      const canRemind = Boolean(
        process.env.RESEND_API_KEY?.trim() ||
        (process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim()),
      );
      const [reminders, recurring] = await Promise.all([
        canRemind ? processDueReminders() : Promise.resolve(null),
        processDueRecurringExpenses(),
      ]);
      if (reminders && reminders.sent > 0) {
        console.log(`[reminders] sent ${reminders.sent} reminder(s)`);
      }
      if (recurring.created > 0) {
        console.log(`[recurring] created ${recurring.created} expense row(s)`);
      }
    } catch (err) {
      console.error("[cron] poll failed:", err);
    }
  };
  /* `bun --hot` re-evaluates this module on every save, which would stack a
     duplicate setInterval (and duplicate reminder/recurring passes) each
     reload. Guard with a global so only the first evaluation schedules it. */
  const globalWithPoller = globalThis as typeof globalThis & {
    __custosDevCronTimer?: ReturnType<typeof setInterval>;
  };
  if (isDbConnected() && !globalWithPoller.__custosDevCronTimer) {
    globalWithPoller.__custosDevCronTimer = setInterval(poll, REMINDER_POLL_INTERVAL_MS);
    void poll();
    console.log("[cron] dev poller active (every 15 min) — reminders + recurring expenses");
  } else if (!isDbConnected()) {
    console.log("[cron] dev poller skipped — MongoDB not connected at startup");
  }
}
