import { connectDb } from "@/db/client";
import { createMiddleware } from "hono/factory";

const DB_MIDDLEWARE_TIMEOUT_MS = 15_000;

export const ensureDb = createMiddleware(async (c, next) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      connectDb(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Database connection timed out")),
          DB_MIDDLEWARE_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database unavailable";
    return c.json({ error: message }, 503);
  } finally {
    /* Otherwise a live timer (and its closure) lingers for the full 15s on
       every request, even on the normal connectDb()-wins path. */
    clearTimeout(timer);
  }
  await next();
});
