import { api } from "./api";

type FxCache = {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const pending = new Map<string, Promise<FxRates>>();
const cache = new Map<string, FxCache>();

type FxRates = {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
};

/** Fetches rates via the app API (ExchangeRate-API key stays server-side). */
export async function fetchFxRates(base: string, fresh = false): Promise<FxRates> {
  const code = (base || "USD").toUpperCase();
  const hit = cache.get(code);
  if (!fresh && hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit;
  }

  const existing = pending.get(code);
  if (existing) return existing;
  const request = api.fx
    .latest(code, { fresh })
    .then((data) => {
      const entry: FxCache = { base: data.base, rates: data.rates, fetchedAt: data.fetchedAt };
      cache.set(code, entry);
      return entry;
    })
    .finally(() => {
      pending.delete(code);
    });
  pending.set(code, request);
  return request;
}

export function fxConvert(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number> | null | undefined,
) {
  const a = from.toUpperCase();
  const b = to.toUpperCase();
  if (a === b || !Number.isFinite(amount)) return amount;
  if (!rates) return amount;
  const rate = rates[b];
  if (typeof rate !== "number" || !Number.isFinite(rate)) return amount;
  return amount * rate;
}
