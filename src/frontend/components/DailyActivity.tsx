import { useMemo, useState } from "react";
import type { DailyState } from "@/frontend/lib/hooks/useDaily";
import { activityRoutines, historicalPeriod, weekStart } from "@/lib/daily";
import { shiftIso } from "@/lib/schedule";
import { Icon } from "./ui";

export function DailyActivity({
  daily,
  tab,
  initialDay,
  initialRoutineId,
}: {
  daily: DailyState;
  tab: "today" | "week";
  initialDay?: string;
  initialRoutineId?: string;
}) {
  const [offset, setOffset] = useState(() =>
    initialDay
      ? Math.max(
          0,
          Math.floor(
            (Date.parse(shiftIso(weekStart(daily.today!), 6)) - Date.parse(initialDay)) /
              (84 * 86400000),
          ),
        )
      : 0,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const end = shiftIso(weekStart(daily.today!), 6 - offset * 84);
  const start = shiftIso(end, -83);
  const days = useMemo(() => Array.from({ length: 84 }, (_, i) => shiftIso(start, i)), [start]);
  const filtered = activityRoutines(daily.routines, daily.today!, tab);
  // A routine may have changed cadence since the searched occurrence; still reveal its history.
  const searched = daily.routines.find((routine) => routine.id === initialRoutineId);
  const routines =
    searched && !filtered.some((routine) => routine.id === searched.id)
      ? [searched, ...filtered]
      : filtered;
  const first = routines.reduce(
    (min, r) => (r.schedule[0]?.from && r.schedule[0].from < min ? r.schedule[0].from : min),
    daily.today!,
  );
  const done = new Set(daily.completions.filter((c) => c.done).map((c) => c.id));
  return (
    <section className="panel daily-activity">
      <div className="panel-head">
        <div>
          <h2>Activity</h2>
          <p className="panel-sub">
            {tab === "today" ? "Daily and weekday routines" : "Weekly routines"} ? Select a day to
            update it.
          </p>
        </div>
        <div className="daily-history-nav">
          <button
            className="icon-btn"
            aria-label="Earlier twelve weeks"
            disabled={!routines.length || start <= first}
            onClick={() => setOffset((n) => n + 1)}
          >
            <Icon name="chevL" size={16} />
          </button>
          <span>
            {start} – {end > daily.today! ? daily.today : end}
          </span>
          <button
            className="icon-btn"
            aria-label="Later twelve weeks"
            disabled={!offset}
            onClick={() => setOffset((n) => n - 1)}
          >
            <Icon name="chevR" size={16} />
          </button>
        </div>
      </div>
      {!routines.length ? (
        <p className="panel-sub">
          {tab === "today"
            ? "No daily or weekday routine history yet."
            : "No weekly routine history yet."}
        </p>
      ) : null}
      {routines.map((routine) => {
        const seen = new Set<string>();
        return (
          <div className="daily-history-routine" key={routine.id}>
            <h3>
              {routine.title}
              {routine.archivedOn ? " · Archived" : ""}
            </h3>
            <div className="daily-heatmap" aria-label={`${routine.title} activity`}>
              {days.map((day) => {
                const period = historicalPeriod(routine, day, daily.today!);
                const duplicate = !!period && seen.has(period);
                if (period) seen.add(period);
                const id = `${routine.id}:${period}`;
                const checked = !!period && done.has(id);
                const pending = daily.pending.some((e) => e.targetId === id);
                const label = `${day}: ${duplicate ? "weekly occurrence shown on Monday" : !period ? "not scheduled" : checked ? "completed; mark incomplete" : "not completed; mark complete"}`;
                return (
                  <button
                    key={day}
                    data-search-id={`daily:${routine.id}:${day}`}
                    type="button"
                    className={`daily-heat-cell${!period || duplicate ? " unavailable" : ""}${checked && !duplicate ? " complete" : ""}${day === daily.today ? " today" : ""}`}
                    disabled={!period || duplicate || busy.has(id)}
                    aria-label={label}
                    title={label}
                    aria-pressed={checked && !duplicate}
                    aria-busy={busy.has(id) || undefined}
                    data-pending={pending || undefined}
                    onClick={async () => {
                      if (!period) return;
                      setBusy((prev) => new Set(prev).add(id));
                      setError("");
                      try {
                        await daily.setHistoricalDone({ routine, period, done: !checked });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not save check-in");
                      } finally {
                        setBusy((prev) => {
                          const next = new Set(prev);
                          next.delete(id);
                          return next;
                        });
                      }
                    }}
                  >
                    {checked && !duplicate ? "✓" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {routines.length ? (
        <p className="panel-sub">
          Filled ✓ completed · outlined missed or open · muted not scheduled. Weekly routines have
          one editable cell per week.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="auth-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
