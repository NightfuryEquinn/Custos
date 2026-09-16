import { useEnter } from "@/frontend/lib/animate";
import { Donut, MiniSpark } from "@/frontend/charts";
import { CatGlyph, EmptyState, Icon, glyphTint } from "@/frontend/components/ui";
import { dayLabel, fmtMoney, monthsWindow } from "@/frontend/lib/data";
import { buildPiggies, type Piggy, type Piglet } from "@/frontend/lib/piggies";
import { computeSavingsInsights, monthlyNetForCat } from "@/frontend/lib/savingsInsights";
import type { CategoryIndex, Expense } from "@/frontend/lib/types";
import { useMemo, useRef } from "react";

const SPARK_MONTHS = 6;

type PiggiesProps = {
  savingsTxns: Expense[];
  savingsLoading?: boolean;
  allExpenses: Expense[];
  categoryIndex: CategoryIndex;
  currency: string;
  month: string;
  onAddDeposit: (piggy: Piggy, sub: Piglet) => void;
  onWithdraw: (piggy: Piggy, sub: Piglet) => void;
};

/**
 * One-glance tracker for every savings category ("piggy") and its subs ("piglets").
 *
 * The headline and per-plan reads of Saving Insights live on the Insights view;
 * what is computed here is the totals row and each card's on-track status, so no
 * Capitals plans are passed — `perPlan` is not rendered on this view.
 */
export function Piggies({
  savingsTxns,
  savingsLoading,
  allExpenses,
  categoryIndex,
  currency,
  month,
  onAddDeposit,
  onWithdraw,
}: PiggiesProps) {
  const piggies = useMemo(
    () => buildPiggies(savingsTxns, categoryIndex),
    [savingsTxns, categoryIndex],
  );
  const insights = useMemo(
    () => computeSavingsInsights(savingsTxns, allExpenses, piggies, categoryIndex, month),
    [savingsTxns, allExpenses, piggies, categoryIndex, month],
  );
  const paceById = useMemo(
    () => new Map(insights.perPiggy.map((p) => [p.catId, p])),
    [insights.perPiggy],
  );
  const sparkMonths = useMemo(() => monthsWindow(month, SPARK_MONTHS), [month]);

  const money = (n: number) => fmtMoney(n, { currency });
  const viewRef = useRef<HTMLDivElement>(null);
  useEnter(viewRef);

  if (!piggies.length) {
    return (
      <div ref={viewRef} className="view">
        {savingsLoading ? (
          <EmptyState title="Loading piggies…" sub="Fetching your savings history." />
        ) : (
          <EmptyState
            title="No piggies yet"
            sub="Add a savings category in Categories to start tracking a piggy."
          />
        )}
      </div>
    );
  }

  return (
    <div ref={viewRef} className="view">
      <div className="piggy-grid" data-tour="tour-piggies-grid">
        {piggies.map((piggy) => {
          const pace = paceById.get(piggy.catId);
          const progressPct =
            piggy.progress !== null ? Math.min(1, Math.max(0, piggy.progress)) : null;
          const donutData = piggy.target
            ? [
                { id: "filled", value: Math.max(piggy.balance, 0), color: piggy.color },
                {
                  id: "remain",
                  value: Math.max(piggy.target - piggy.balance, 0),
                  color: "var(--hair)",
                },
              ]
            : [{ id: "filled", value: 1, color: piggy.color }];
          const spark = [
            ...monthlyNetForCat(savingsTxns, piggy.catId, categoryIndex, sparkMonths).values(),
          ];
          const primarySub = piggy.piglets[0];

          return (
            <div key={piggy.catId} className="piggy-card">
              <div className="piggy-card-head">
                <span className="piggy-card-glyph" style={glyphTint(piggy.color)}>
                  <CatGlyph glyph={piggy.glyph} id={piggy.catId} />
                </span>
                <div className="piggy-card-title">
                  <h3>{piggy.name}</h3>
                  {piggy.archived ? <span className="piggy-tag">Archived</span> : null}
                </div>
              </div>

              <div className="piggy-card-body">
                <div className="piggy-ring">
                  <Donut
                    data={donutData}
                    size={92}
                    thickness={12}
                    onHover={() => {}}
                    activeId={null}
                  />
                  <div className="piggy-ring-label">
                    {progressPct !== null ? `${Math.round(progressPct * 100)}%` : "—"}
                  </div>
                </div>
                <div className="piggy-card-stats">
                  <div className="piggy-balance">{money(piggy.balance)}</div>
                  <div className="piggy-target">
                    {piggy.target ? `of ${money(piggy.target)} goal` : "no goal set"}
                  </div>
                  {piggy.deadline ? (
                    <div className="piggy-deadline">Due {dayLabel(piggy.deadline)}</div>
                  ) : null}
                  {pace?.onTrack === false ? (
                    <div className="piggy-status piggy-status--warn">Behind pace</div>
                  ) : null}
                  {pace?.onTrack === true ? (
                    <div className="piggy-status piggy-status--ok">On track</div>
                  ) : null}
                </div>
                {spark.some((v) => v !== 0) ? (
                  <MiniSpark values={spark} color={piggy.color} />
                ) : null}
              </div>

              {piggy.piglets.length > 1 ? (
                <div className="piggy-piglets">
                  {piggy.piglets.map((p) => (
                    <div key={p.subId} className="piglet-row">
                      <span className="piglet-name">
                        {p.name}
                        {p.archived ? <span className="piggy-tag">Archived</span> : null}
                      </span>
                      <span className="piglet-balance">{money(p.balance)}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {primarySub && !primarySub.archived ? (
                <div className="piggy-card-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => onAddDeposit(piggy, primarySub)}
                  >
                    <Icon name="plus" size={15} /> Add
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={piggy.balance <= 0}
                    onClick={() => onWithdraw(piggy, primarySub)}
                  >
                    Withdraw
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
