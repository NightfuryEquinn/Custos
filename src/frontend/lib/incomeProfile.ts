import type { CategoryIndex } from "./categories";
import { monthLabel, monthsWindow, roundMoney } from "./data";
import { clamp01, confidenceLevel, stats1D, topBin, type Confidence } from "./stat-helpers";
import { classifyTx } from "./stats";
import type { Expense } from "./types";

/*
 * Income Profile
 * ──────────────
 * The spending-habit engine's counterpart for money coming in.
 *
 * Income is structurally unlike spend and does not fit that engine:
 * a salaried user logs one or two rows a month, so there is no per-month
 * pattern to read. The window is therefore months, not days; the gate counts
 * payments and months rather than active days; sources are keyed by
 * SUBcategory (the default taxonomy is one Income category with five subs);
 * and the interesting axes are concentration, predictability, floor and
 * growth rather than rhythm and impulse.
 */

export type IncomeWindow = "6mo" | "12mo";

export type IncomeStyleId =
  "salaried" | "variable" | "projectBased" | "portfolio" | "windfall" | "emerging";

type IncomeStyleMeta = {
  id: IncomeStyleId;
  title: string;
  trait: string;
  temperament: string;
};

export const INCOME_STYLES: Record<IncomeStyleId, IncomeStyleMeta> = {
  salaried: {
    id: "salaried",
    title: "The Salaried Anchor",
    trait: "Anchored",
    temperament: "Predictable / Anchored",
  },
  variable: {
    id: "variable",
    title: "The Variable Earner",
    trait: "Variable",
    temperament: "Steady cadence / Shifting size",
  },
  projectBased: {
    id: "projectBased",
    title: "The Project Earner",
    trait: "Project",
    temperament: "Lumpy / Deal-driven",
  },
  portfolio: {
    id: "portfolio",
    title: "The Portfolio Earner",
    trait: "Portfolio",
    temperament: "Diversified / Layered",
  },
  windfall: {
    id: "windfall",
    title: "The Windfall Earner",
    trait: "Windfall",
    temperament: "Spike-driven / Uneven",
  },
  emerging: {
    id: "emerging",
    title: "The Emerging Stream",
    trait: "Emerging",
    temperament: "Early / Forming",
  },
};

/** Payments needed before a profile is offered. */
export const INCOME_MIN_EVENTS = 3;
/** Distinct months with income needed before a profile is offered. */
export const INCOME_MIN_MONTHS = 2;

/** The signals the Insights view, the archetype scoring and the confidence score read. */
type IncomeMetrics = {
  txCount: number;
  monthsInWindow: number;
  monthsWithIncome: number;
  monthsZero: number;

  amountCv: number;
  /** Share of the window's income carried by its single largest payment. */
  largestShare: number;

  gapCv: number;
  topDomShare: number;

  sourceCount: number;
  topSourceShare: number;
  /** Herfindahl concentration: 1 = a single source, ~0 = evenly split. */
  hhi: number;

  monthlyMean: number;
};

type IncomeConfidence = Confidence;

type IncomeAssessment =
  | {
      status: "insufficient";
      txHave: number;
      txNeeded: number;
      monthsHave: number;
      monthsNeeded: number;
      windowLabel: string;
    }
  | {
      status: "ready";
      style: IncomeStyleMeta;
      metrics: IncomeMetrics;
      confidence: IncomeConfidence;
      blend: { secondary: IncomeStyleMeta | null; weight: number; label: string };
      windowLabel: string;
    };

/** How many months a window spans. */
function windowSize(window: IncomeWindow) {
  return window === "6mo" ? 6 : 12;
}

/** Human label for the window under assessment. */
function incomeWindowLabel(window: IncomeWindow, monthKey: string) {
  const months = monthsWindow(monthKey, windowSize(window));
  const first = months[0]?.key ?? monthKey;
  const last = months[months.length - 1]?.key ?? monthKey;

  return `${monthLabel(first, false)} – ${monthLabel(last, false)}`;
}

/** Day-of-month from an ISO date, without constructing a Date. */
function domOf(iso: string) {
  return Number(iso.slice(8, 10));
}

/** Whole days between two ISO dates. */
function daysBetween(a: string, b: string) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const start = Date.UTC(ay!, am! - 1, ad!);
  const end = Date.UTC(by!, bm! - 1, bd!);

  return Math.round((end - start) / 86_400_000);
}

type IncomePoint = {
  date: string;
  amount: number;
};

const EMPTY_METRICS: IncomeMetrics = {
  txCount: 0,
  monthsInWindow: 0,
  monthsWithIncome: 0,
  monthsZero: 0,
  amountCv: 0,
  largestShare: 0,
  gapCv: 0,
  topDomShare: 0,
  sourceCount: 0,
  topSourceShare: 0,
  hhi: 0,
  monthlyMean: 0,
};

const EMPTY_SCORES: Record<IncomeStyleId, number> = {
  salaried: 0,
  variable: 0,
  projectBased: 0,
  portfolio: 0,
  windfall: 0,
  emerging: 0,
};

/**
 * The income signals for a window, plus the raw archetype scores.
 *
 * One pass over `expenses`: income rows feed the payment, cadence and source
 * accumulators. Spend is ignored, and so are savings — moving money into an
 * envelope is neither income nor a cost of living.
 */
export function computeIncomeMetrics(
  expenses: Expense[],
  monthKey: string,
  window: IncomeWindow,
  index?: CategoryIndex,
): { metrics: IncomeMetrics; scores: Record<IncomeStyleId, number> } {
  const months = monthsWindow(monthKey, windowSize(window));
  const monthIdx = new Map(months.map((m, i) => [m.key, i]));
  const earnedByMonth = new Array<number>(months.length).fill(0);

  const points: IncomePoint[] = [];
  const sourceAmounts = new Map<string, number>();

  for (const e of expenses) {
    const slot = monthIdx.get(e.date.slice(0, 7));
    if (slot === undefined) continue;

    if (classifyTx(e, index) !== "income") continue;

    earnedByMonth[slot] = (earnedByMonth[slot] ?? 0) + e.amount;
    points.push({ date: e.date, amount: e.amount });
    sourceAmounts.set(e.sub, (sourceAmounts.get(e.sub) ?? 0) + e.amount);
  }

  if (!points.length) {
    return {
      metrics: { ...EMPTY_METRICS, monthsInWindow: months.length, monthsZero: months.length },
      scores: { ...EMPTY_SCORES },
    };
  }

  points.sort((a, b) => a.date.localeCompare(b.date));

  const amounts = points.map((p) => p.amount);
  const total = amounts.reduce((s, v) => s + v, 0);
  const amountStats = stats1D(amounts);

  // Cadence: gaps between distinct payment days, walked in order so no Set or
  // second sort is needed.
  const gaps: number[] = [];
  let prevDate = "";
  const domHist = new Map<number, number>();

  for (const p of points) {
    if (prevDate && p.date !== prevDate) gaps.push(daysBetween(prevDate, p.date));
    prevDate = p.date;

    const dom = domOf(p.date);
    domHist.set(dom, (domHist.get(dom) ?? 0) + 1);
  }

  const gapStats = stats1D(gaps);
  const topDomBin = topBin(domHist, points.length);
  const largest = amounts.reduce((max, v) => (v > max ? v : max), 0);

  // Sources are keyed by subcategory, the meaningful grain for income.
  const shares = [...sourceAmounts.values()]
    .map((amount) => (total ? amount / total : 0))
    .sort((a, b) => b - a);
  const hhi = shares.reduce((s, share) => s + share ** 2, 0);
  // Only sources carrying real weight count toward diversification, so a
  // rounding-error trickle cannot pass for a second income stream.
  const sourceCount = shares.filter((share) => share >= 0.05).length;

  const monthlyEarned = earnedByMonth.map((v) => roundMoney(v));
  const monthsWithIncome = monthlyEarned.filter((v) => v > 0).length;

  const metrics: IncomeMetrics = {
    txCount: points.length,
    monthsInWindow: months.length,
    monthsWithIncome,
    monthsZero: months.length - monthsWithIncome,

    amountCv: amountStats.cv,
    largestShare: total ? largest / total : 0,

    gapCv: gapStats.cv,
    topDomShare: topDomBin.share,

    sourceCount,
    topSourceShare: shares[0] ?? 0,
    hhi,

    monthlyMean: roundMoney(stats1D(monthlyEarned).mean),
  };

  return { metrics, scores: scoreIncomeStyles(metrics) };
}

/** Score each income archetype from a window's metrics. */
function scoreIncomeStyles(m: IncomeMetrics): Record<IncomeStyleId, number> {
  if (!m.txCount) return { ...EMPTY_SCORES };

  const monthPresence = m.monthsInWindow ? m.monthsWithIncome / m.monthsInWindow : 0;
  const zeroShare = m.monthsInWindow ? m.monthsZero / m.monthsInWindow : 0;
  const largestShare = m.largestShare;

  // A salaried cheque is steady to within a few percent, so the steadiness term
  // is scored against a tight band: a 50% swing earns nothing from it, which is
  // what separates this from `variable` when both land on a monthly rhythm.
  const salaried = clamp01(
    m.topSourceShare * 0.3 +
      (1 - clamp01(m.amountCv / 0.5)) * 0.25 +
      m.topDomShare * 0.2 +
      monthPresence * 0.25,
  );

  // Variable is defined by a dependable *rhythm* carrying undependable amounts,
  // so missed months disqualify it — below 60% presence the cadence term is
  // zero and the archetype cannot win on amount swing alone.
  const variable = clamp01(
    clamp01((monthPresence - 0.6) / 0.4) * 0.35 +
      (1 - Math.min(m.gapCv, 1.2) / 1.2) * 0.25 +
      clamp01(m.amountCv / 0.35) * 0.3 +
      m.topSourceShare * 0.1,
  );

  // Dry months are the defining signal here, not a footnote: a quarter of the
  // window with no income at all saturates the term.
  const projectBased = clamp01(
    Math.min(1, m.gapCv / 1.2) * 0.3 +
      Math.min(1, m.amountCv / 0.8) * 0.25 +
      clamp01(zeroShare / 0.25) * 0.35 +
      m.hhi * 0.1,
  );

  const portfolio = clamp01(
    Math.min(1, (m.sourceCount - 1) / 3) * 0.45 + (1 - m.hhi) * 0.35 + monthPresence * 0.2,
  );

  const windfall = clamp01(
    Math.max(0, (largestShare - 0.4) / 0.5) * 0.65 + Math.min(1, m.amountCv / 1.2) * 0.35,
  );

  const emerging = clamp01(
    (1 - monthPresence) * 0.4 +
      (1 - Math.min(1, m.txCount / 8)) * 0.4 +
      (1 - m.topSourceShare) * 0.2,
  );

  return { salaried, variable, projectBased, portfolio, windfall, emerging };
}

/** Score entries sorted strongest first, with a stable tie-break. */
export function rankIncomeStyles(scores: Record<IncomeStyleId, number>): [IncomeStyleId, number][] {
  const entries = Object.entries(scores) as [IncomeStyleId, number][];

  return entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Winning archetype, falling back to `emerging` when nothing scores clearly. */
export function pickIncomeStyle(scores: Record<IncomeStyleId, number>): IncomeStyleId {
  return pickFromRanked(rankIncomeStyles(scores));
}

function pickFromRanked(ranked: [IncomeStyleId, number][]): IncomeStyleId {
  const [topId, topScore] = ranked[0] ?? ["emerging", 0];
  if (topScore < 0.22) return "emerging";

  return topId;
}

/**
 * How much the verdict can be trusted: sample size (months and payments)
 * blended with how far the leader sits ahead of the runner-up.
 */
function incomeConfidence(ranked: [IncomeStyleId, number][], m: IncomeMetrics): IncomeConfidence {
  const topScore = ranked[0]?.[1] ?? 0;
  const runnerUp = ranked[1]?.[1] ?? 0;
  const margin = topScore - runnerUp;

  // Sample size dominates on purpose. A wide margin between two archetypes
  // scored off two months of data is a confident reading of almost nothing, so
  // margin alone must not be able to lift a thin window out of "low".
  const value = clamp01(
    clamp01((m.monthsWithIncome - INCOME_MIN_MONTHS) / 6) * 0.45 +
      clamp01(m.txCount / 12) * 0.25 +
      clamp01(margin / 0.15) * 0.2 +
      clamp01((topScore - 0.22) / 0.38) * 0.1,
  );

  const runnerUpTitle = ranked[1] ? INCOME_STYLES[ranked[1][0]].title : "";
  const reasons = [
    `${m.monthsWithIncome} of ${m.monthsInWindow} months with income`,
    `${m.txCount} payments`,
    runnerUpTitle
      ? margin >= 0.1
        ? `clear lead over ${runnerUpTitle}`
        : `close call with ${runnerUpTitle}`
      : "",
  ].filter(Boolean);

  return { level: confidenceLevel(value), value, margin, reasons };
}

/** Secondary archetype when the runner-up scores close enough to matter. */
export function incomeBlend(ranked: [IncomeStyleId, number][]): {
  secondary: IncomeStyleMeta | null;
  weight: number;
  label: string;
} {
  const top = ranked[0];
  const second = ranked[1];
  const primaryTitle = top ? INCOME_STYLES[top[0]].title : INCOME_STYLES.emerging.title;

  if (!top || !second) return { secondary: null, weight: 0, label: primaryTitle };

  const qualifies = second[1] >= 0.45 * top[1] && second[1] >= 0.2;
  if (!qualifies) return { secondary: null, weight: 0, label: primaryTitle };

  const secondary = INCOME_STYLES[second[0]];
  const weight = top[1] + second[1] > 0 ? second[1] / (top[1] + second[1]) : 0;

  return { secondary, weight, label: `${primaryTitle}, with a ${secondary.trait} streak` };
}

/** Distinct months carrying income, from a pre-filtered list. */
function monthsWithIncomeIn(
  expenses: Expense[],
  monthKey: string,
  window: IncomeWindow,
  index?: CategoryIndex,
) {
  const months = new Set(monthsWindow(monthKey, windowSize(window)).map((m) => m.key));
  const seen = new Set<string>();
  let txCount = 0;

  for (const e of expenses) {
    const key = e.date.slice(0, 7);
    if (!months.has(key)) continue;
    if (classifyTx(e, index) !== "income") continue;
    seen.add(key);
    txCount += 1;
  }

  return { months: seen.size, txCount };
}

/**
 * Assess the income profile for a rolling window.
 *
 * The gate runs before any metrics work: a ledger with one or two income rows
 * is the common case early on, and it should cost a single scan rather than a
 * full computation.
 */
export function assessIncomeProfile(
  expenses: Expense[],
  monthKey: string,
  window: IncomeWindow,
  index?: CategoryIndex,
): IncomeAssessment {
  const windowLabel = incomeWindowLabel(window, monthKey);
  const { months, txCount } = monthsWithIncomeIn(expenses, monthKey, window, index);

  if (txCount < INCOME_MIN_EVENTS || months < INCOME_MIN_MONTHS) {
    return {
      status: "insufficient",
      txHave: txCount,
      txNeeded: INCOME_MIN_EVENTS,
      monthsHave: months,
      monthsNeeded: INCOME_MIN_MONTHS,
      windowLabel,
    };
  }

  const { metrics, scores } = computeIncomeMetrics(expenses, monthKey, window, index);
  const ranked = rankIncomeStyles(scores);
  const id = pickFromRanked(ranked);

  return {
    status: "ready",
    style: INCOME_STYLES[id],
    metrics,
    confidence: incomeConfidence(ranked, metrics),
    blend: incomeBlend(ranked),
    windowLabel,
  };
}

/** True when the wallet declares a monthly income on top of logged transactions. */
export function declaresMonthlyIncome(
  wallet?: {
    fundingMode?: string;
    income?: number;
  } | null,
) {
  return Boolean(wallet && wallet.fundingMode === "monthly" && (wallet.income ?? 0) > 0);
}
