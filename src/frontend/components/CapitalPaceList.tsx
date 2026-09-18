import type { CapitalPace } from "@/frontend/lib/savingsInsights";

/**
 * Status chip for one Capitals plan. Overpaid wins over funded — both have
 * nothing left to set aside, but only one of them is good news. A plan with no
 * budget has nothing to judge, and gets no chip at all.
 */
function PaceStatus({ plan }: { plan: CapitalPace }) {
  if (plan.overbudget) {
    return <span className="capital-pace-status capital-pace-status--warn">Overpaid</span>;
  }
  if (plan.funded) {
    return <span className="capital-pace-status capital-pace-status--ok">Funded</span>;
  }
  if (plan.onTrack === true) {
    return <span className="capital-pace-status capital-pace-status--ok">On pace</span>;
  }
  if (plan.onTrack === false) {
    return <span className="capital-pace-status capital-pace-status--warn">Behind pace</span>;
  }

  return null;
}

type PaceMetric = {
  label: string;
  value: string;
};

/** Collect the paced metrics shown under one Capitals plan name. */
function paceMetrics(plan: CapitalPace, money: (n: number) => string): PaceMetric[] {
  const metrics: PaceMetric[] = [{ label: "Set aside", value: money(plan.saved) }];

  if (plan.unspent !== plan.saved) {
    metrics.push({ label: "Unspent", value: money(plan.unspent) });
  }
  if (plan.remainingNeed > 0) {
    metrics.push({ label: "To go", value: money(plan.remainingNeed) });
  }
  if (plan.monthlyPace > 0) {
    metrics.push({ label: "Pace", value: `${money(plan.monthlyPace)}/mo` });
  }
  if (plan.requiredMonthly) {
    metrics.push({ label: "Needed", value: `${money(plan.requiredMonthly)}/mo` });
  }
  if (plan.projectedCompletion) {
    metrics.push({ label: "Projected", value: plan.projectedCompletion });
  }

  return metrics;
}

/**
 * The Capitals half of Piggy Insights: one card per plan with what is set
 * aside, how much of that is still unspent, what is left, the pace it is being
 * saved at, and where that leaves it against the target date. Shared by the
 * Piggies and Insights views, which format money differently (Insights can
 * convert currency), so `money` comes from the caller.
 */
export function CapitalPaceList({
  plans,
  money,
}: {
  plans: CapitalPace[];
  money: (n: number) => string;
}) {
  if (!plans.length) return null;

  return (
    <div className="capital-pace-list">
      {plans.map((plan) => (
        <div key={plan.planId} className="capital-pace-row">
          <span className="capital-pace-glyph" aria-hidden="true">
            {plan.glyph}
          </span>
          <div className="capital-pace-main">
            <div className="capital-pace-head">
              <span className="capital-pace-name">{plan.name}</span>
              <PaceStatus plan={plan} />
            </div>
            <div className="capital-pace-metrics">
              {paceMetrics(plan, money).map((metric) => (
                <div key={metric.label} className="capital-pace-metric">
                  <span className="capital-pace-metric-label">{metric.label}</span>
                  <span className="capital-pace-metric-value">{metric.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
