import { LoadingBloom } from "@/frontend/components/LoadingBloom";
import { EmptyState } from "@/frontend/components/ui";
import type { DailyState } from "@/frontend/lib/hooks/useDaily";
import type { ViewId } from "@/frontend/lib/types";
import { dueRows, progressOf } from "@/lib/daily";

/** Rows Home previews, matching its other lists. */
const HOME_ROWS = 5;

/** Home's Daily section: today's progress and what is still to do. */
export function DailyHomePanel({
  daily,
  setView,
}: {
  daily: DailyState;
  setView: (view: ViewId) => void;
}) {
  const rows =
    daily.ready && daily.today
      ? dueRows(daily.routines, daily.completions, daily.today, "today")
      : [];
  const { done, total } = progressOf(rows);
  const left = rows.filter((row) => !row.done).slice(0, HOME_ROWS);

  return (
    <section className="panel" data-tour="tour-overview-daily">
      <div className="panel-head panel-head--row">
        <h2>Daily</h2>
        <button type="button" className="link-btn" onClick={() => setView("daily")}>
          View all
        </button>
      </div>
      {daily.loading ? (
        <LoadingBloom size="sm" />
      ) : !daily.ready ? (
        <EmptyState title="Daily isn't available yet" />
      ) : total ? (
        <>
          <div className="daily-progress">
            <span className="daily-count">
              <strong>
                {done}/{total}
              </strong>{" "}
              done today
            </span>
            <progress value={done} max={total} aria-label="Daily progress" />
          </div>
          <div className="recent-list">
            {left.length ? (
              left.map((row) => (
                <button
                  key={row.routine.id}
                  type="button"
                  className="recent-row"
                  onClick={() => setView("daily")}
                >
                  <span className="rr-main">
                    <span className="rr-note">{row.routine.title}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="daily-all-done" role="status">
                All done for today
              </p>
            )}
          </div>
        </>
      ) : (
        <EmptyState title={daily.routines.length ? "Nothing due today" : "No routines yet"} />
      )}
    </section>
  );
}
