import type { useLedger } from "./hooks/useLedger";
import type { BehaviourEvent } from "./personalization-client";
import type { SearchTarget } from "./search/model";
import { holdsByCategory } from "./envelope-holds";
import { assessSpendingHabit } from "./spendingHabits";
import { classifyTx } from "./stats";
import { currentPeriod } from "@/lib/daily";
import { scheduleForMonth } from "./data";
import { shiftIso } from "@/lib/schedule";
import { buildPiggies } from "./piggies";
import { computeSavingsInsights } from "./savingsInsights";
import { assessVehicleFuel, computeFuelInsights, VEHICLE_TYPES } from "./fuelInsights";

export type Suggestion = {
  id: string;
  domain: string;
  title: string;
  reason: string;
  priority: number;
  score: number;
  target: SearchTarget;
};
export function rankSuggestions(
  candidates: Suggestion[],
  history: BehaviourEvent[],
  now = Date.now(),
): Suggestion[] {
  const recent = history.filter(
    (e) => now - Date.parse(e.at) < 30 * 86400000 && Date.parse(e.at) <= now,
  );
  const ranked = candidates
    .filter(
      (c) =>
        !recent.some(
          (e) =>
            e.type === "dismissed" && e.candidate === c.id && now - Date.parse(e.at) < 7 * 86400000,
        ),
    )
    .map((c) => {
      const events = recent.filter((e) => e.domain === c.domain);
      const days = new Set(
        events
          .filter((e) => e.type === "visited" || e.type === "action")
          .map((e) => e.at.slice(0, 10)),
      ).size;
      const adjust = Math.max(
        -0.15,
        Math.min(
          0.15,
          0.02 * days +
            0.05 * events.filter((e) => e.type === "helpful").length -
            0.05 * events.filter((e) => e.type === "dismissed").length,
        ),
      );
      const shown = recent.some(
        (e) => e.type === "shown" && e.candidate === c.id && now - Date.parse(e.at) < 3 * 86400000,
      );
      return { ...c, score: c.score + adjust - (shown ? 0.05 : 0) };
    })
    .sort((a, b) => b.priority - a.priority || b.score - a.score || a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  return ranked
    .filter((c) => {
      if (seen.has(c.id) || (counts.get(c.domain) ?? 0) >= 2) return false;
      seen.add(c.id);
      counts.set(c.domain, (counts.get(c.domain) ?? 0) + 1);
      return true;
    })
    .slice(0, 6);
}
export function generateSuggestions(
  ledger: ReturnType<typeof useLedger>,
  today: string,
  events: typeof ledger.homeEvents | null = ledger.homeEvents,
): Suggestion[] {
  const out: Suggestion[] = [],
    month = today.slice(0, 7),
    wallet = ledger.activeWallet;
  const add = (
    domain: string,
    id: string,
    title: string,
    reason: string,
    target: SearchTarget,
    priority = 0,
    score = 0.5,
  ) => out.push({ id: `v1:${domain}:${id}`, domain, title, reason, target, priority, score });
  const page = (
    view: SearchTarget["view"],
    id: string,
    kind: SearchTarget["kind"] = "page",
  ): SearchTarget => ({ view, kind, id });
  if (wallet && events && ledger.financialHistoryComplete && ledger.categoryIndex) {
    const txns = ledger.accountExpenses.filter((e) => e.walletId === wallet.id);
    const holds = holdsByCategory(events, month);
    for (const category of ledger.categoryIndex.spendingCategories) {
      const budget = wallet.budgets[category.id] ?? 0;
      const spent = txns
        .filter(
          (e) =>
            e.date.startsWith(month) &&
            ledger.categoryIndex.subById[e.sub]?.catId === category.id &&
            classifyTx(e, ledger.categoryIndex) === "spend",
        )
        .reduce((s, e) => s + e.amount, 0);
      const ratio = budget > 0 ? (spent + (holds[category.id] ?? 0)) / budget : 0;
      if (ratio >= 0.8)
        add(
          "budgets",
          `${wallet.id}:${category.id}:${month}`,
          `Review ${category.name}`,
          `${Math.round(ratio * 100)}% of this month's budget is spent or reserved.`,
          { ...page("budgets", category.id, "budget"), walletId: wallet.id, date: today },
          ratio >= 1 ? 2 : 1,
          Math.min(1, ratio),
        );
    }
    const assessment = assessSpendingHabit(txns, "month", month, ledger.categoryIndex);
    const spending = txns.filter((e) => classifyTx(e, ledger.categoryIndex) === "spend");
    const total = (from: string, to: string) =>
      spending.filter((e) => e.date >= from && e.date <= to).reduce((sum, e) => sum + e.amount, 0);
    const recent = total(shiftIso(today, -6), today),
      prior = total(shiftIso(today, -13), shiftIso(today, -7));
    if (assessment.status === "ready" && prior > 0 && recent >= prior * 1.25)
      add(
        "transactions",
        `${wallet.id}:${month}:spending`,
        "Review your recent spending",
        `Recorded spending over the last seven days is ${Math.round((recent / prior - 1) * 100)}% higher than the preceding seven days.`,
        { ...page("transactions", "transactions"), walletId: wallet.id, date: today },
        1,
        0.6 * assessment.confidence.value,
      );
    const piggies = buildPiggies(txns, ledger.categoryIndex, wallet.id);
    const savings = computeSavingsInsights(
      txns,
      txns,
      piggies,
      ledger.categoryIndex,
      month,
      12,
      ledger.capitalPlans,
    );
    for (const p of savings.perPiggy)
      if (p.onTrack === false)
        add(
          "piggies",
          `${wallet.id}:${p.catId}:${month}`,
          "Review your savings pace",
          "Recorded savings are behind the pace needed for this goal.",
          { ...page("piggies", p.catId), walletId: wallet.id },
          1,
          0.7,
        );
    for (const p of savings.perPlan)
      if (p.onTrack === false || p.overbudget)
        add(
          "capitals",
          `${wallet.id}:${p.planId}:${month}`,
          `Review ${p.name}`,
          p.overbudget
            ? "Recorded payments exceed this plan's budget."
            : "Recorded savings are behind this plan's target pace.",
          page("capitals", p.planId, "capital"),
          1,
          0.7,
        );
  }
  for (const { ev, iso } of scheduleForMonth(events ?? [], month).concat(
    shiftIso(today, 3).slice(0, 7) !== month
      ? scheduleForMonth(events ?? [], shiftIso(today, 3).slice(0, 7))
      : [],
  )) {
    if (ev.catId !== "bill" || iso < today || iso > shiftIso(today, 3)) continue;
    if (
      ev.budgetHoldReleasedDates?.includes(iso) ||
      (ev.repeat === "once" && ev.expenseId) ||
      ledger.accountExpenses.some((e) => e.eventId === ev.id && e.date === iso)
    )
      continue;
    add(
      "schedule",
      `${ev.id}:${iso}`,
      `Review ${ev.title}`,
      `Due ${iso}; payment has not been logged.`,
      { ...page("schedule", ev.id, "event"), date: iso },
      1,
      0.8,
    );
  }
  for (const list of ledger.todoLists) {
    const remaining = list.tasks.filter((t) => !t.done).length;
    if (remaining)
      add(
        "todos",
        list.id,
        `Review ${list.name}`,
        `${remaining} unfinished tasks in this list.`,
        page("todos", list.id, "todo"),
      );
  }
  for (const routine of ledger.daily.routines) {
    const period = currentPeriod(routine, today);
    if (
      period &&
      !ledger.daily.completions.some(
        (c) => c.routineId === routine.id && c.period === period && c.done,
      )
    )
      add(
        "daily",
        routine.id,
        routine.title,
        "This routine is due and has no completed check-in for the current period.",
        { ...page("daily", routine.id, "daily"), date: today },
      );
  }
  for (const n of ledger.nudges.nudges) {
    const count = n.progress.day === today ? n.progress.count : 0;
    if (count < n.target)
      add(
        "nudge",
        n.id,
        n.title,
        `${count} of ${n.target} ${n.unit} recorded today.`,
        page("nudge", n.id, "nudge"),
      );
  }
  for (const vehicle of ledger.vehicles) {
    const assessment = assessVehicleFuel(
      ledger.vehicleFills.filter((f) => f.vehicleId === vehicle.id),
    );
    if (assessment.status !== "ready") continue;
    for (const insight of computeFuelInsights(
      assessment.metrics,
      VEHICLE_TYPES[vehicle.type],
      assessment.confidence,
    ))
      if (insight.tone === "warning" || insight.tone === "critical")
        add(
          "vehicles",
          `${vehicle.id}:${insight.id}:${month}`,
          insight.title,
          insight.body,
          page("vehicles", vehicle.id, "vehicle"),
          1,
          insight.score,
        );
  }
  return out;
}
