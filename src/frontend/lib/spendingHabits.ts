import { CURRENT_MONTH_KEY, TODAY_ISO, dayLabel, isoFromDate, monthsWindow } from "./data";
import type { CategoryIndex } from "./categories";
import {
  clamp01,
  confidenceLevel,
  cv,
  mean,
  percentileOf,
  sorted,
  stats1D,
  topBin,
  type Confidence,
  type ConfidenceLevel,
} from "./stat-helpers";
import { isOutgoing, isSavings } from "./stats";
import type { Expense } from "./types";

export type HabitPeriod = "month" | "year" | "rolling90";

export type HabitStyleId =
  "clockwork" | "burst" | "dripper" | "peakValley" | "accumulator" | "nomad";

type HabitStyleMeta = {
  id: HabitStyleId;
  title: string;
  /** Short trait label used in the blend line ("with a Burst streak"). */
  trait: string;
  /** Four-letter tag under each habit-trail bar (e.g. DRIP, PEAK). */
  tag: string;
  temperament: string;
};

export const HABIT_STYLES: Record<HabitStyleId, HabitStyleMeta> = {
  clockwork: {
    id: "clockwork",
    title: "The Clockwork Spender",
    trait: "Clockwork",
    tag: "CLCK",
    temperament: "Reserved / Predictable",
  },
  burst: {
    id: "burst",
    title: "The Burst Spender",
    trait: "Burst",
    tag: "BRST",
    temperament: "Impulsive / Reactive",
  },
  dripper: {
    id: "dripper",
    title: "The Steady Dripper",
    trait: "Drip",
    tag: "DRIP",
    temperament: "Habitual / Mindless",
  },
  peakValley: {
    id: "peakValley",
    title: "The Peak-and-Valley Spender",
    trait: "Peak-and-Valley",
    tag: "PEAK",
    temperament: "Cyclical / Thoughtful",
  },
  accumulator: {
    id: "accumulator",
    title: "The Calculated Accumulator",
    trait: "Batch",
    tag: "BTCH",
    temperament: "Strategic / Deliberate",
  },
  nomad: {
    id: "nomad",
    title: "The Erratic Nomad",
    trait: "Erratic",
    tag: "ERRA",
    temperament: "Chaotic / Unstructured",
  },
};

/** Minimum distinct calendar days with outgoing spend before a style is revealed. */
export const HABIT_MIN_ACTIVE_DAYS = 5;

/** The signals the Insights view and the confidence score read; scoring keeps its own locals. */
type HabitMetrics = {
  txCount: number;
  activeDays: number;
  /** Share of transactions on the busiest weekday, 0..1. */
  topDowShare: number;
  /** First date that fell on that weekday, for a readable weekday name. */
  topDowSampleDate: string;
};

/** Confidence shape is shared with the income engine — see `stat-helpers`. */
type HabitConfidenceLevel = ConfidenceLevel;
type HabitConfidence = Confidence;

type HabitAssessment =
  | {
      status: "insufficient";
      daysHave: number;
      daysNeeded: number;
      periodLabel: string;
    }
  | {
      status: "ready";
      style: HabitStyleMeta;
      metrics: HabitMetrics;
      confidence: HabitConfidence;
      blend: { secondary: HabitStyleMeta | null; weight: number; label: string };
      periodLabel: string;
    };

type TxPoint = {
  date: string;
  amount: number;
  dayOfWeek: number;
  dayOfMonth: number;
  time: number;
};

/** Parse YYYY-MM-DD into local calendar parts used by habit scoring. */
function parseDateParts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  return {
    dayOfWeek: date.getDay(),
    dayOfMonth: d!,
    time: date.getTime(),
  };
}

/**
 * Group transactions into clusters where consecutive points are within
 * `windowMs` of each other (default 48 hours).
 */
function buildClusters(points: TxPoint[], windowMs = 48 * 60 * 60 * 1000) {
  if (!points.length) return [] as TxPoint[][];
  const clusters: TxPoint[][] = [[points[0]!]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (cur.time - prev.time <= windowMs) {
      clusters[clusters.length - 1]!.push(cur);
    } else {
      clusters.push([cur]);
    }
  }
  return clusters;
}

/** Day gaps between consecutive unique calendar dates, given dates already ascending. */
function gapsFromOrderedDates(dates: string[], times: number[]) {
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(Math.round((times[i]! - times[i - 1]!) / 86_400_000));
  }
  return gaps;
}

/**
 * Score how strongly spend rises after a fixed day-of-month and then tapers
 * through the rest of the cycle (payday front-loading).
 */
function peakValleyScore(points: TxPoint[]) {
  if (points.length < HABIT_MIN_ACTIVE_DAYS) return 0;

  const byMonth = new Map<string, TxPoint[]>();
  for (const p of points) {
    const key = p.date.slice(0, 7);
    const list = byMonth.get(key) || [];
    list.push(p);
    byMonth.set(key, list);
  }

  const monthScores: number[] = [];
  for (const list of byMonth.values()) {
    if (list.length < 3) continue;

    const byDom = new Map<number, number>();
    for (const p of list) {
      byDom.set(p.dayOfMonth, (byDom.get(p.dayOfMonth) || 0) + p.amount);
    }

    const days = [...byDom.keys()].sort((a, b) => a - b);
    if (days.length < 3) continue;

    let bestPeak = days[0]!;
    let bestAmt = -1;
    for (const d of days) {
      const amt = byDom.get(d) || 0;
      if (amt > bestAmt) {
        bestAmt = amt;
        bestPeak = d;
      }
    }

    const after = days.filter((d) => d >= bestPeak);
    if (after.length < 2) continue;

    const series = after.map((d) => byDom.get(d) || 0);
    let declines = 0;
    for (let i = 1; i < series.length; i++) {
      if (series[i]! <= series[i - 1]! * 1.05) declines += 1;
    }
    const taper = declines / (series.length - 1);
    const peakShare =
      bestAmt /
      Math.max(
        1,
        series.reduce((s, v) => s + v, 0),
      );
    monthScores.push(clamp01(taper * 0.65 + peakShare * 0.35));
  }

  if (!monthScores.length) return 0;
  return mean(monthScores);
}

/** Sorted-ascending TxPoint list, with dayOfWeek/dayOfMonth/time cached per distinct date. */
function buildPoints(expenses: Expense[]): TxPoint[] {
  const dateCache = new Map<string, { dayOfWeek: number; dayOfMonth: number; time: number }>();
  const points: TxPoint[] = expenses.map((e) => {
    let parts = dateCache.get(e.date);
    if (!parts) {
      parts = parseDateParts(e.date);
      dateCache.set(e.date, parts);
    }
    return {
      date: e.date,
      amount: e.amount,
      dayOfWeek: parts.dayOfWeek,
      dayOfMonth: parts.dayOfMonth,
      time: parts.time,
    };
  });
  points.sort((a, b) => a.time - b.time || a.date.localeCompare(b.date));
  return points;
}

/**
 * Compute the signals behind a habit verdict, plus the six archetype scores
 * derived from them.
 */
export function computeHabitMetrics(expenses: Expense[]): {
  metrics: HabitMetrics;
  scores: Record<HabitStyleId, number>;
} {
  const points = buildPoints(expenses);
  const txCount = points.length;

  // One pass: amounts, calendar histograms, unique dates.
  const amounts: number[] = new Array(txCount);
  let sum = 0;
  let sumSq = 0;
  const dowCount = new Map<number, number>();
  const domCount = new Map<number, number>();
  const dowFirstDate = new Map<number, string>();
  const amountBuckets = new Map<number, number>();
  const uniqueDates: string[] = [];
  const uniqueTimes: number[] = [];

  let lastDate = "";
  for (let i = 0; i < txCount; i++) {
    const p = points[i]!;
    amounts[i] = p.amount;
    sum += p.amount;
    sumSq += p.amount * p.amount;

    dowCount.set(p.dayOfWeek, (dowCount.get(p.dayOfWeek) || 0) + 1);
    if (!dowFirstDate.has(p.dayOfWeek)) dowFirstDate.set(p.dayOfWeek, p.date);
    domCount.set(p.dayOfMonth, (domCount.get(p.dayOfMonth) || 0) + 1);

    const roundedAmt = Math.round(p.amount * 100) / 100;
    amountBuckets.set(roundedAmt, (amountBuckets.get(roundedAmt) || 0) + 1);

    if (p.date !== lastDate) {
      uniqueDates.push(p.date);
      uniqueTimes.push(p.time);
      lastDate = p.date;
    }
  }

  const activeDays = uniqueDates.length;
  const meanAmt = txCount ? sum / txCount : 0;
  const variance = txCount ? Math.max(0, sumSq / txCount - meanAmt * meanAmt) : 0;
  const amountStdev = Math.sqrt(variance);
  const amountCv = txCount >= 2 && meanAmt !== 0 ? amountStdev / Math.abs(meanAmt) : 0;

  const sortedAmounts = sorted(amounts);
  const medianAmt = percentileOf(sortedAmounts, 0.5);
  const p90 = percentileOf(sortedAmounts, 0.9);

  const gaps = gapsFromOrderedDates(uniqueDates, uniqueTimes);
  const { mean: meanGap, cv: gapCv } = stats1D(gaps);
  const quietGaps = gaps.filter((g) => g >= 5).length;
  const quietShare = gaps.length ? quietGaps / gaps.length : 0;

  const mode = topBin(amountBuckets, txCount);
  const dowShareBin = topBin(dowCount, txCount);
  const domShareBin = topBin(domCount, txCount);

  const denseClusters = buildClusters(points).filter((c) => c.length >= 4);

  const dayFocus = Math.max(dowShareBin.share, domShareBin.share);
  const bursty =
    denseClusters.length > 0 && quietShare >= 0.3 && activeDays >= HABIT_MIN_ACTIVE_DAYS;

  // ── archetype scores (formulas unchanged from the original implementation) ──
  const clockwork = clamp01(
    mode.share * 0.55 +
      (1 - Math.min(gapCv, 1.5) / 1.5) * 0.35 +
      (meanGap >= 5 && meanGap <= 35 ? 0.1 : 0),
  );

  let burst = 0;
  if (bursty) {
    const clusterSizes = denseClusters.map((c) => c.length);
    const inCluster = denseClusters.reduce((s, c) => s + c.length, 0);
    const clusterShare = inCluster / points.length;
    const clusterAmountCv = mean(denseClusters.map((c) => cv(c.map((p) => p.amount))));
    burst = clamp01(
      clusterShare * 0.4 +
        Math.min(1, mean(clusterSizes) / 6) * 0.25 +
        clusterAmountCv * 0.25 +
        quietShare * 0.1,
    );
  }

  const dailyRate = activeDays > 0 ? points.length / activeDays : 0;
  const smallShare = p90 > 0 ? medianAmt / p90 : 0;
  const dripper = clamp01(
    Math.min(1, activeDays / 18) * 0.35 +
      Math.min(1, points.length / 22) * 0.25 +
      (1 - Math.min(amountCv, 1.2) / 1.2) * 0.2 +
      (smallShare > 0.15 && smallShare < 0.55 ? 0.2 : smallShare * 0.1) +
      (dailyRate >= 1.1 ? 0.05 : 0),
  );

  const peakValley = peakValleyScore(points);

  const largeBatch =
    medianAmt > 0 && p90 > 0
      ? clamp01((medianAmt / Math.max(medianAmt, meanAmt)) * (p90 / Math.max(p90, meanAmt)))
      : 0;
  const lowFrequency = clamp01(1 - Math.min(1, points.length / Math.max(activeDays * 2, 10)));
  const accumulator = clamp01(
    dayFocus * 0.55 + largeBatch * 0.2 + lowFrequency * 0.15 + (dayFocus > 0.45 ? 0.1 : 0),
  );

  const nomad = clamp01(
    Math.min(1, amountCv / 1.4) * 0.4 +
      Math.min(1, gapCv / 1.6) * 0.4 +
      (1 - dayFocus) * 0.15 +
      (1 - mode.share) * 0.05,
  );

  const scores: Record<HabitStyleId, number> = {
    clockwork,
    burst,
    dripper,
    peakValley,
    accumulator,
    nomad,
  };

  const metrics: HabitMetrics = {
    txCount,
    activeDays,
    topDowShare: dowShareBin.share,
    topDowSampleDate: dowFirstDate.get(dowShareBin.value) ?? "",
  };

  return { metrics, scores };
}

/** Score each habit style from a period's transaction list. */
export function scoreHabitStyles(expenses: Expense[]): Record<HabitStyleId, number> {
  return computeHabitMetrics(expenses).scores;
}

/** Style ids ranked by score, highest first, ties broken alphabetically by id. */
export function rankStyles(scores: Record<HabitStyleId, number>): [HabitStyleId, number][] {
  const entries = Object.entries(scores) as [HabitStyleId, number][];
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries;
}

/** Pick the winning habit style from a ranked score list. */
export function pickHabitStyle(scores: Record<HabitStyleId, number>): HabitStyleId {
  return pickFromRanked(rankStyles(scores));
}

function pickFromRanked(ranked: [HabitStyleId, number][]): HabitStyleId {
  const [topId, topScore] = ranked[0]!;
  const second = ranked[1]?.[1] ?? 0;

  // Prefer a clear patterned style over nomad when the lead is weak.
  if (topId === "nomad" && second >= topScore - 0.04) {
    const patterned = ranked.find(([id]) => id !== "nomad");
    if (patterned && patterned[1] >= 0.28) return patterned[0];
  }

  if (topScore < 0.22) return "nomad";
  return topId;
}

/** Confidence in the winning style, from the score separation and sample size. */
function habitConfidence(ranked: [HabitStyleId, number][], metrics: HabitMetrics): HabitConfidence {
  const topScore = ranked[0]![1];
  const runnerUp = ranked[1];
  const margin = topScore - (runnerUp?.[1] ?? 0);

  const value = clamp01(
    0.4 * clamp01((metrics.activeDays - HABIT_MIN_ACTIVE_DAYS) / 13) +
      0.25 * clamp01(metrics.txCount / 25) +
      0.25 * clamp01(margin / 0.15) +
      0.1 * clamp01((topScore - 0.22) / 0.38),
  );
  const level: HabitConfidenceLevel = confidenceLevel(value);

  const reasons: string[] = [
    `${metrics.activeDays} active day${metrics.activeDays === 1 ? "" : "s"}`,
  ];
  if (runnerUp) {
    const runnerUpTitle = HABIT_STYLES[runnerUp[0]].title;
    reasons.push(
      margin >= 0.1 ? `clear lead over ${runnerUpTitle}` : `close call with ${runnerUpTitle}`,
    );
  }

  return { level, value, margin, reasons };
}

/** Secondary trait blended in when the runner-up style is close behind the winner. */
export function habitBlend(ranked: [HabitStyleId, number][]): {
  secondary: HabitStyleMeta | null;
  weight: number;
  label: string;
} {
  const [topId, topScore] = ranked[0]!;
  const primaryStyle = HABIT_STYLES[topId];
  const runnerUp = ranked[1];

  if (!runnerUp || topScore <= 0) {
    return { secondary: null, weight: 0, label: primaryStyle.title };
  }

  const [secondId, secondScore] = runnerUp;
  const qualifies = secondScore >= 0.45 * topScore && secondScore >= 0.2;
  if (!qualifies) return { secondary: null, weight: 0, label: primaryStyle.title };

  const secondary = HABIT_STYLES[secondId];
  return {
    secondary,
    weight: secondScore,
    label: `${primaryStyle.title}, with a ${secondary.trait} streak`,
  };
}

/** Collect outgoing non-savings transactions for the selected habit period. */
export function habitPeriodExpenses(
  expenses: Expense[],
  period: HabitPeriod,
  monthKey: string,
  index?: CategoryIndex,
) {
  if (period === "rolling90") {
    const { start, end } = rolling90Bounds(monthKey);
    return expenses
      .filter((e) => isOutgoing(e) && !isSavings(e, index) && e.date >= start && e.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
  }

  const prefix = period === "month" ? monthKey : monthKey.slice(0, 4);
  return expenses
    .filter((e) => isOutgoing(e) && !isSavings(e, index) && e.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
}

/** Inclusive [start, end] ISO bounds for the rolling-90-day window anchored on `monthKey`. */
function rolling90Bounds(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  const end = monthKey === CURRENT_MONTH_KEY ? TODAY_ISO : isoFromDate(new Date(y!, m!, 0));
  const [ey, em, ed] = end.split("-").map(Number);
  const start = isoFromDate(new Date(ey!, em! - 1, ed! - 89));
  return { start, end };
}

/** Human label for the period under assessment. */
function habitPeriodLabel(period: HabitPeriod, monthKey: string) {
  if (period === "rolling90") {
    const { end } = rolling90Bounds(monthKey);
    return `the 90 days to ${dayLabel(end)}`;
  }
  if (period === "year") return monthKey.slice(0, 4);
  const [y, m] = monthKey.split("-").map(Number);
  const name = new Date(y!, m! - 1, 1).toLocaleString("en", { month: "long" });
  return `${name} ${y}`;
}

/** Count of distinct calendar dates in an already date-sorted expense list. */
function countActiveDays(list: Expense[]) {
  let count = 0;
  let last = "";
  for (const e of list) {
    if (e.date !== last) {
      count += 1;
      last = e.date;
    }
  }
  return count;
}

/**
 * Assess spending habit style for a month, year, or rolling-90-day window.
 * Requires at least {@link HABIT_MIN_ACTIVE_DAYS} distinct transaction days.
 */
export function assessSpendingHabit(
  expenses: Expense[],
  period: HabitPeriod,
  monthKey: string,
  index?: CategoryIndex,
): HabitAssessment {
  const periodLabel = habitPeriodLabel(period, monthKey);
  const list = habitPeriodExpenses(expenses, period, monthKey, index);
  const activeDays = countActiveDays(list);

  if (activeDays < HABIT_MIN_ACTIVE_DAYS) {
    return {
      status: "insufficient",
      daysHave: activeDays,
      daysNeeded: HABIT_MIN_ACTIVE_DAYS,
      periodLabel,
    };
  }

  const { metrics, scores } = computeHabitMetrics(list);
  const ranked = rankStyles(scores);
  const id = pickFromRanked(ranked);
  const confidence = habitConfidence(ranked, metrics);
  const blend = habitBlend(ranked);

  return {
    status: "ready",
    style: HABIT_STYLES[id],
    metrics,
    confidence,
    blend,
    periodLabel,
  };
}

type HabitTrajectoryPoint = {
  monthKey: string;
  status: "insufficient" | "ready";
  styleId: HabitStyleId | null;
  /** Four-letter chart tag, empty while the month is insufficient. */
  tag: string;
  spend: number;
};

/**
 * Trailing `size` months of habit verdicts, anchored on `monthKey`. Always a
 * monthly window regardless of the panel's selected period, and always the
 * trailing 6 months — a single pass over `expenses`.
 */
export function habitTrajectory(
  expenses: Expense[],
  monthKey: string,
  index?: CategoryIndex,
  size = 6,
): HabitTrajectoryPoint[] {
  const months = monthsWindow(monthKey, size);
  const order = new Map(months.map((mo, i) => [mo.key, i]));
  const buckets: Expense[][] = months.map(() => []);

  for (const e of expenses) {
    if (!isOutgoing(e) || isSavings(e, index)) continue;
    const idx = order.get(e.date.slice(0, 7));
    if (idx === undefined) continue;
    buckets[idx]!.push(e);
  }

  return months.map((mo, i) => {
    const list = buckets[i]!;
    const activeDays = countActiveDays(list);
    const spend = list.reduce((s, e) => s + e.amount, 0);

    if (activeDays < HABIT_MIN_ACTIVE_DAYS) {
      return { monthKey: mo.key, status: "insufficient", styleId: null, tag: "", spend };
    }

    const { scores } = computeHabitMetrics(list);
    const ranked = rankStyles(scores);
    const styleId = pickFromRanked(ranked);

    return { monthKey: mo.key, status: "ready", styleId, tag: HABIT_STYLES[styleId].tag, spend };
  });
}

/** One-line summary of how the style has moved across a trajectory. */
export function describeHabitShift(points: HabitTrajectoryPoint[]): string {
  const ready = points.filter((p) => p.status === "ready");
  if (ready.length < 2) return "Not enough history to compare yet.";

  let runLength = 1;
  for (let i = ready.length - 1; i > 0; i--) {
    if (ready[i]!.styleId === ready[i - 1]!.styleId) runLength += 1;
    else break;
  }

  const current = ready[ready.length - 1]!;
  const currentTitle = HABIT_STYLES[current.styleId!].title;

  if (runLength >= 2) {
    return `${currentTitle} for ${runLength} months running.`;
  }

  const prev = ready[ready.length - 2]!;
  const prevTitle = HABIT_STYLES[prev.styleId!].title;
  const prevLabel = new Date(2000, Number(prev.monthKey.slice(5, 7)) - 1, 1).toLocaleString("en", {
    month: "long",
  });
  return `Was ${prevTitle} in ${prevLabel} — now ${currentTitle}.`;
}
