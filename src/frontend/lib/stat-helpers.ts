/**
 * Numeric helpers shared by the spending-habit and income-profile engines.
 *
 * Both engines follow the same discipline: build their histograms and sorted
 * arrays once, then read statistics off them. The `*Of` variants here take
 * pre-sorted / pre-built inputs precisely so nothing re-sorts inside a loop.
 */

/** Mean of a numeric list, or 0 when empty. */
export function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Population standard deviation. */
export function stdev(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** Coefficient of variation, capped for empty / zero-mean lists. */
export function cv(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  if (m === 0) return 0;
  return stdev(values) / Math.abs(m);
}

/**
 * Mean, population stdev and coefficient of variation in one pass.
 * Prefer this over calling {@link mean} then {@link cv}, which walks the list
 * three times for one statistic.
 */
export function stats1D(values: number[]): { mean: number; stdev: number; cv: number } {
  const n = values.length;
  if (!n) return { mean: 0, stdev: 0, cv: 0 };

  let sum = 0;
  let sumSq = 0;
  for (const v of values) {
    sum += v;
    sumSq += v * v;
  }

  const m = sum / n;
  if (n < 2) return { mean: m, stdev: 0, cv: 0 };

  // Clamp at 0: floating-point drift can push a zero-variance set slightly negative.
  const variance = Math.max(0, sumSq / n - m * m);
  const sd = Math.sqrt(variance);

  return { mean: m, stdev: sd, cv: m === 0 ? 0 : sd / Math.abs(m) };
}

/** Clamp a score into [0, 1]. */
export function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

/** Sort ascending without mutating the source. */
export function sorted(values: number[]) {
  return [...values].sort((a, b) => a - b);
}

/** Percentile of an already-ascending-sorted list (linear interpolation). No allocation, no sort. */
export function percentileOf(s: number[], p: number): number {
  if (!s.length) return 0;
  if (s.length === 1) return s[0]!;
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo]!;
  const t = idx - lo;
  return s[lo]! * (1 - t) + s[hi]! * t;
}

/** Largest bin in a prebuilt histogram, as {value, count, share}. */
export function topBin(
  hist: Map<number, number>,
  total: number,
): { value: number; count: number; share: number } {
  let bestKey = 0;
  let bestCount = 0;
  for (const [key, count] of hist) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  return { value: bestKey, count: bestCount, share: total ? bestCount / total : 0 };
}

/** How much a verdict can be trusted, given sample size and lead over the runner-up. */
export type ConfidenceLevel = "low" | "medium" | "high";

export type Confidence = {
  level: ConfidenceLevel;
  value: number;
  margin: number;
  reasons: string[];
};

/** Band a 0..1 confidence value. Shared so both engines cut at the same thresholds. */
export function confidenceLevel(value: number): ConfidenceLevel {
  if (value >= 0.66) return "high";
  if (value >= 0.38) return "medium";
  return "low";
}

/**
 * Money formatter seam. Engines never format currency themselves — the Insights
 * view applies FX conversion in its own `money()`, so an engine-side `Intl` call
 * would render wallet currency while the rest of the panel shows view currency.
 */
export type Formatters = { money: (n: number) => string };

export const DEFAULT_FORMATTERS: Formatters = { money: (n: number) => String(Math.round(n)) };
