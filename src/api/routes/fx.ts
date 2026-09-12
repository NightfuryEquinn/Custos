import { badRequest } from "@/api/lib/errors";
import { sessionAuth, type SessionVariables } from "@/api/middleware/session";
import { CURRENCY_CODES } from "@/schemas/wallet";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

const CACHE_TTL_MS = 60 * 60 * 1000;
/* Without this, a hung upstream burns the whole 30s function maxDuration
   (vercel.json) instead of failing fast into a 502. */
const UPSTREAM_TIMEOUT_MS = 8_000;

type FxCache = {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
};

const cache = new Map<string, FxCache>();

export const fxRoutes = new Hono<{ Variables: SessionVariables }>();

fxRoutes.use("*", sessionAuth);

fxRoutes.get("/latest/:base", async (c) => {
  const base = c.req.param("base").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) badRequest("Invalid currency code");
  if (!CURRENCY_CODES.includes(base as (typeof CURRENCY_CODES)[number])) {
    badRequest("Unsupported currency code");
  }

  const hit = cache.get(base);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return c.json({
      base: hit.base,
      rates: hit.rates,
      fetchedAt: hit.fetchedAt,
      cached: true,
    });
  }

  const apiKey = process.env.EXCHANGE_RATE_API_KEY?.trim();
  if (!apiKey) {
    throw new HTTPException(503, { message: "EXCHANGE_RATE_API_KEY not configured" });
  }

  const url = `https://v6.exchangerate-api.com/v6/${apiKey}/latest/${encodeURIComponent(base)}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch {
    throw new HTTPException(502, { message: "Exchange rate request timed out" });
  }
  const data = (await res.json().catch(() => null)) as {
    result?: string;
    "error-type"?: string;
    base_code?: string;
    conversion_rates?: Record<string, number>;
  } | null;

  if (!res.ok || data?.result !== "success" || !data.conversion_rates) {
    const message = data?.["error-type"] || `Exchange rate request failed (${res.status})`;
    throw new HTTPException(502, { message });
  }

  const rates: Record<string, number> = { [base]: 1 };
  for (const code of CURRENCY_CODES) {
    const rate = data.conversion_rates[code];
    if (typeof rate === "number") rates[code] = rate;
  }

  const entry: FxCache = {
    base: data.base_code ?? base,
    rates,
    fetchedAt: Date.now(),
  };
  cache.set(base, entry);

  return c.json({
    base: entry.base,
    rates: entry.rates,
    fetchedAt: entry.fetchedAt,
    cached: false,
  });
});
