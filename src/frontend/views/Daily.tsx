import { ConfirmDialog, EmptyState, Icon, Segmented } from "@/frontend/components/ui";
import { LoadingBloom } from "@/frontend/components/LoadingBloom";
import { useEnter, useModalMotion } from "@/frontend/lib/animate";
import { toast } from "@/frontend/lib/feedback";
import type { DailyState } from "@/frontend/lib/hooks/useDaily";
import {
  DAILY_POINTS,
  computeStreak,
  dueRows,
  editSchedule,
  newRoutine,
  points,
  idleRoutines,
  progressOf,
  type DailyKind,
  type DailyRow,
  type DailyRoutine,
} from "@/lib/daily";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/*
 * Daily view
 * ──────────
 * Recurring checklists with points and per-routine streaks. Today holds daily
 * and selected-weekday routines; This week holds once-a-week routines.
 * Everything shown is derived from the routines and their completion history.
 */

/** Imperative handle so the shell's page action can open the editor. */
export type DailyHandle = { openAdd: () => void };

type Tab = "today" | "week";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const KIND_OPTIONS: { v: DailyKind; label: string }[] = [
  { v: "daily", label: "Every day" },
  { v: "weekdays", label: "Selected weekdays" },
  { v: "weekly", label: "Once a week" },
];

type Editor = { routineId: string | null } | null;

/** "3 days" / "1 week" — the unit follows the routine's current recurrence. */
const streakLabel = (n: number, unit: "day" | "week") => `${n} ${unit}${n === 1 ? "" : "s"}`;

export const Daily = forwardRef<DailyHandle, { daily: DailyState }>(function Daily({ daily }, ref) {
  const { routines, completions, today, pending } = daily;
  const [tab, setTab] = useState<Tab>("today");
  const [editor, setEditor] = useState<Editor>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [kind, setKind] = useState<DailyKind>("daily");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [earned, setEarned] = useState<string | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  const savingRef = useRef(false);
  useEnter(viewRef);

  const fields = JSON.stringify([title, notes, kind, weekdays]);
  const [baseline, setBaseline] = useState(fields);
  const { dismiss } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    active: !!editor,
    onDismiss: saving || archiving ? false : () => setEditor(null),
    dirty: fields !== baseline,
  });

  /* The +10 flash is brief and goes away on its own. */
  useEffect(() => {
    if (!earned) return;
    const timer = setTimeout(() => setEarned(null), 1400);
    return () => clearTimeout(timer);
  }, [earned]);

  const editing = editor?.routineId ? routines.find((r) => r.id === editor.routineId) : undefined;

  const rows = useMemo(
    () => (today ? dueRows(routines, completions, today, tab) : []),
    [routines, completions, today, tab],
  );
  const { done, total } = progressOf(rows);
  const lifetime = useMemo(() => points(completions), [completions]);
  const active = routines.filter((r) => !r.archivedOn);
  const idle = useMemo(() => (today ? idleRoutines(routines, today) : []), [routines, today]);
  const archived = routines.filter((r) => r.archivedOn);

  /** Per-row save state, from the queued writes for this routine and period. */
  const syncOf = (row: DailyRow): "syncing" | "failed" | null => {
    /* The routine's own queued write counts too: a tick can't sync while its routine hasn't. */
    const entries = pending.filter(
      (e) =>
        (e.entity === "dailyCompletion" && e.targetId === `${row.routine.id}:${row.period}`) ||
        (e.entity === "dailyRoutine" && e.targetId === row.routine.id),
    );
    if (entries.some((e) => e.status === "failed" || e.status === "blocked")) return "failed";
    return entries.length ? "syncing" : null;
  };

  const openEditor = (routine?: DailyRoutine) => {
    const rule = routine?.schedule.at(-1);
    const next = {
      title: routine?.title ?? "",
      notes: routine?.notes ?? "",
      kind: rule?.kind ?? ("daily" as DailyKind),
      weekdays: rule?.weekdays ?? [],
    };
    setEditor({ routineId: routine?.id ?? null });
    setTitle(next.title);
    setNotes(next.notes);
    setKind(next.kind);
    setWeekdays(next.weekdays);
    setBaseline(JSON.stringify([next.title, next.notes, next.kind, next.weekdays]));
    setEditorError("");
  };

  useImperativeHandle(ref, () => ({ openAdd: () => openEditor() }));

  const toggle = async (row: DailyRow) => {
    setError("");
    try {
      await daily.setDone(row.routine, !row.done);
      if (!row.done) setEarned(row.routine.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update routine");
    }
  };

  const addInline = async () => {
    const value = draft.trim();
    if (!value || !today || savingRef.current) return;
    savingRef.current = true;
    setError("");
    try {
      await daily.saveRoutine(
        newRoutine({ title: value, kind: "daily" }, today, new Date().toISOString()),
      );
      setDraft((current) => (current.trim() === value ? "" : current));
      setTab("today");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add routine");
    } finally {
      savingRef.current = false;
    }
  };

  const submitEditor = async () => {
    if (!editor || !today || savingRef.current) return;
    if (!title.trim()) return setEditorError("A title is required");
    if (kind === "weekdays" && !weekdays.length) return setEditorError("Pick at least one weekday");

    savingRef.current = true;
    setSaving(true);
    setEditorError("");
    try {
      const rule = {
        kind,
        ...(kind === "weekdays" ? { weekdays: [...weekdays].sort() } : {}),
      };
      const now = new Date().toISOString();
      if (editing) {
        const started = completions.some((c) => c.routineId === editing.id && c.done);
        const same = JSON.stringify(rule) === JSON.stringify(stripFrom(editing.schedule.at(-1)));
        await daily.saveRoutine({
          ...editing,
          title: title.trim(),
          notes: notes.trim(),
          schedule: same ? editing.schedule : editSchedule(editing.schedule, rule, today, started),
        });
      } else {
        const created = newRoutine(
          { title: title.trim(), notes: notes.trim(), kind, weekdays },
          today,
          now,
        );
        await daily.saveRoutine(created);
        setTab(kind === "weekly" ? "week" : "today");
      }
      toast(editing ? "Routine updated" : "Routine added");
      setEditor(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not save routine");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const archive = async (routine: DailyRoutine) => {
    if (!today) return;
    setArchiving(true);
    try {
      await daily.saveRoutine({ ...routine, archivedOn: today });
      toast("Routine archived");
      setEditor(null);
    } finally {
      setArchiving(false);
    }
  };

  if (daily.loading) {
    return (
      <div ref={viewRef} className="view view-loading">
        <LoadingBloom />
      </div>
    );
  }

  if (!daily.ready || !today) {
    return (
      <div ref={viewRef} className="view">
        <EmptyState
          title="Daily isn't available offline yet"
          sub="Connect once to download your routines."
        />
      </div>
    );
  }

  const pendingChange = editing?.schedule.at(-1);
  const futureChange = pendingChange && pendingChange.from > today ? pendingChange.from : null;

  return (
    <div ref={viewRef} className="view">
      {active.length ? (
        <>
          <div className="daily-top">
            <Segmented
              options={[
                { v: "today", label: "Today" },
                { v: "week", label: "This week" },
              ]}
              value={tab}
              onChange={setTab}
            />
            <div className="daily-progress" data-tour="tour-daily-progress">
              <span className="daily-count">
                <strong>
                  {done}/{total}
                </strong>{" "}
                done
              </span>
              <progress value={done} max={Math.max(total, 1)} aria-label="Progress" />
              <span className="daily-points">{lifetime} points</span>
            </div>
          </div>

          <section className="panel" data-tour="tour-daily-list">
            <div className="todo-task-list">
              {rows.length ? (
                rows.map((row) => {
                  const sync = syncOf(row);
                  return (
                    <div key={row.routine.id} className={"todo-task" + (row.done ? " done" : "")}>
                      <button
                        type="button"
                        className={"todo-check" + (row.done ? " checked" : "")}
                        onClick={() => void toggle(row)}
                        aria-pressed={row.done}
                        aria-label={`${row.routine.title}: ${row.done ? "mark incomplete" : "mark complete"}`}
                      >
                        {row.done ? <Icon name="check" size={14} /> : null}
                      </button>
                      <button
                        type="button"
                        className="daily-title todo-task-title"
                        onClick={() => openEditor(row.routine)}
                      >
                        {row.routine.title}
                      </button>
                      {earned === row.routine.id ? (
                        <span className="daily-plus" aria-hidden="true">
                          +{DAILY_POINTS}
                        </span>
                      ) : null}
                      {sync ? (
                        <span className={"daily-sync" + (sync === "failed" ? " failed" : "")}>
                          {sync === "failed" ? "Couldn't save" : "Syncing…"}
                        </span>
                      ) : null}
                      <span
                        className="daily-streak"
                        title={`Best: ${streakLabel(row.streak.best, row.unit)}`}
                      >
                        {streakLabel(row.streak.current, row.unit)}
                      </span>
                    </div>
                  );
                })
              ) : (
                <EmptyState
                  title={tab === "today" ? "Nothing due today" : "No weekly routines"}
                  sub={tab === "week" ? "Add one with Once a week." : undefined}
                />
              )}
            </div>
            {tab === "today" && idle.length ? (
              <div className="daily-idle">
                <span className="journal-eyebrow">Not due today</span>
                {idle.map((routine) => (
                  <button
                    key={routine.id}
                    type="button"
                    className="daily-title daily-idle-row"
                    onClick={() => openEditor(routine)}
                  >
                    {routine.title}
                  </button>
                ))}
              </div>
            ) : null}
            {total > 0 && done === total ? (
              <p className="daily-all-done" role="status">
                {tab === "today" ? "All done for today" : "All done this week"}
              </p>
            ) : null}

            <div className="todo-add-row" data-tour="tour-daily-add">
              <input
                className="text-in"
                value={draft}
                maxLength={120}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a daily routine…"
                aria-label="New routine title"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addInline();
                }}
              />
              <button
                className="ghost-btn"
                type="button"
                disabled={!draft.trim()}
                onClick={() => void addInline()}
              >
                Add
              </button>
            </div>
            {error ? (
              <p className="auth-error auth-error--gap" role="alert">
                {error}
              </p>
            ) : null}
          </section>
        </>
      ) : (
        <section className="panel" data-tour="tour-daily-list">
          <div data-tour="tour-daily-progress">
            <EmptyState title="No routines yet" />
            <div className="todo-empty-action" data-tour="tour-daily-add">
              <button className="ghost-btn" type="button" onClick={() => openEditor()}>
                <Icon name="plus" size={15} /> Add routine
              </button>
            </div>
          </div>
        </section>
      )}

      {archived.length ? (
        <section className="panel daily-archived">
          <button
            type="button"
            className="link-btn"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((open) => !open)}
          >
            Archived ({archived.length})
          </button>
          {showArchived ? (
            <ul className="daily-archive-list">
              {archived.map((routine) => {
                const doneSet = new Set(
                  completions
                    .filter((c) => c.routineId === routine.id && c.done)
                    .map((c) => c.period),
                );
                return (
                  <li key={routine.id}>
                    <span className="todo-task-title">{routine.title}</span>
                    <span className="daily-streak">
                      Best {computeStreak(routine, doneSet, today).best} ·{" "}
                      {doneSet.size * DAILY_POINTS} points
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      {editor
        ? createPortal(
            <div
              ref={scrimRef}
              className="modal-scrim center"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) dismiss();
              }}
            >
              <form
                ref={panelRef}
                className="modal sm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="daily-editor-title"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitEditor();
                }}
              >
                <div className="modal-head">
                  <h3 id="daily-editor-title">{editing ? "Edit routine" : "Add routine"}</h3>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={dismiss}
                    aria-label="Close"
                    disabled={saving || archiving}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
                <div className="modal-body modal-scroll">
                  <div className="dm-sec">
                    <label className="fld-label" htmlFor="daily-title">
                      Title
                    </label>
                    <input
                      id="daily-title"
                      className="text-in wallet-field"
                      value={title}
                      maxLength={120}
                      autoFocus
                      onChange={(e) => setTitle(e.target.value)}
                    />

                    <span className="fld-label">Repeats</span>
                    <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} />
                    {kind === "weekdays" ? (
                      <div className="sub-row" role="group" aria-label="Weekdays">
                        {WEEKDAYS.map((label, i) => (
                          <button
                            key={label}
                            type="button"
                            role="checkbox"
                            aria-checked={weekdays.includes(i)}
                            className={"sub-chip" + (weekdays.includes(i) ? " active" : "")}
                            onClick={() =>
                              setWeekdays((prev) =>
                                prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i],
                              )
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {futureChange ? (
                      <p className="fld-hint">Changes from {futureChange}.</p>
                    ) : editing ? (
                      <p className="fld-hint">Changes to how it repeats start after today.</p>
                    ) : null}

                    <label className="fld-label" htmlFor="daily-notes">
                      Notes
                    </label>
                    <textarea
                      id="daily-notes"
                      className="text-in"
                      rows={3}
                      maxLength={1000}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />

                    {editorError ? (
                      <p className="auth-error auth-error--gap" role="alert">
                        {editorError}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="modal-foot">
                  {editing ? (
                    <ArchiveButton
                      disabled={saving || archiving}
                      onConfirm={() => archive(editing)}
                      title={editing.title}
                    />
                  ) : (
                    <span />
                  )}
                  <div className="mf-right">
                    <button
                      className="ghost-btn"
                      type="button"
                      onClick={dismiss}
                      disabled={saving || archiving}
                    >
                      Cancel
                    </button>
                    <button
                      className="primary-btn"
                      type="submit"
                      disabled={saving || archiving || !title.trim()}
                    >
                      {saving ? "Saving…" : editing ? "Save changes" : "Add routine"}
                    </button>
                  </div>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});

/** A schedule entry without its start date, for comparing recurrence only. */
function stripFrom(rule: DailyRoutine["schedule"][number] | undefined) {
  if (!rule) return undefined;
  return { kind: rule.kind, ...(rule.kind === "weekdays" ? { weekdays: rule.weekdays } : {}) };
}

function ArchiveButton({
  title,
  disabled,
  onConfirm,
}: {
  title: string;
  disabled: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [asking, setAsking] = useState(false);

  return (
    <>
      <button
        className="ghost-btn"
        type="button"
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        Archive
      </button>
      {asking ? (
        <ConfirmDialog
          title="Archive routine"
          message={`Archive "${title}"? It stops appearing, and its history and points are kept.`}
          confirmLabel="Archive"
          pendingLabel="Archiving…"
          danger={false}
          arm={false}
          onCancel={() => setAsking(false)}
          onConfirm={async () => {
            await onConfirm();
            setAsking(false);
          }}
        />
      ) : null}
    </>
  );
}
