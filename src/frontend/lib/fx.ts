import { api } from "./api";

type FxCache = {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, FxCache>();

type FxRates = {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
};

/** Fetches rates via the app API (ExchangeRate-API key stays server-side). */
export async function fetchFxRates(base: string): Promise<FxRates> {
  const code = (base || "USD").toUpperCase();
  const hit = cache.get(code);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit;
  }

  const data = await api.fx.latest(code);
  const entry: FxCache = {
    base: data.base,
    rates: data.rates,
    fetchedAt: data.fetchedAt,
  };
  cache.set(code, entry);
  return entry;
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
