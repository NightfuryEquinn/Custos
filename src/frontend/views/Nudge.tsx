import { useSearchReveal, focusSearchRecord } from "@/frontend/lib/search/reveal";
import { NudgeHistory, NudgeBloom } from "@/frontend/components/NudgeHistory";
import { TimePicker } from "@/frontend/components/DateTimePicker";
import { LoadingBloom } from "@/frontend/components/LoadingBloom";
import { ConfirmDialog, EmptyState, Icon } from "@/frontend/components/ui";
import { useEnter, useModalMotion } from "@/frontend/lib/animate";
import { fmtTime } from "@/frontend/lib/data";
import { toast } from "@/frontend/lib/feedback";
import type { NudgesState } from "@/frontend/lib/hooks/useNudges";
import {
  enablePush,
  pushStatus,
  PUSH_FAILURE_NOTE,
  type PushStatus,
} from "@/frontend/lib/push/subscribe";
import {
  NUDGE_DEFAULT_WINDOW,
  NUDGE_EVERY_STEP,
  NUDGE_MAX_EVERY,
  NUDGE_MIN_EVERY,
  countToday,
  everyLabel,
  goalMet,
  nextNudgeAt,
  toMinutes,
  type Nudge as NudgeRow,
} from "@/lib/nudge";
import { zonedTodayIso } from "@/lib/recurring";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";

/*
 * Nudge view
 * ──────────
 * Repeating reminders with a daily count goal ("drink water: 8 glasses"). The
 * count is kept per day, so a new day starts at zero by itself. Notifications go
 * out as Web Push from the server's reminder cron, inside each nudge's own hours,
 * and stop for the day once the goal is met.
 */

/** Imperative handle so the shell's page action can open the editor. */
export type NudgeHandle = { openAdd: () => void };

type Editor = { nudgeId: string | null } | null;

const DEFAULT_EVERY = 60;
const DEFAULT_TARGET = "8";

/** "2:30 PM" for an instant in the account's timezone, with "tomorrow" when it falls on a later day. */
function nextLabel(at: Date, timeZone: string, today: string): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);

  return zonedTodayIso(timeZone, at) === today ? time : `tomorrow ${time}`;
}

export const Nudge = forwardRef<NudgeHandle, { nudge: NudgesState; month: string }>(function Nudge(
  { nudge, month },
  ref,
) {
  const { nudges, today, timeZone, pending } = nudge;
  const [searchDay, setSearchDay] = useState<{ id: string; day: string } | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [unit, setUnit] = useState("");
  const [stepBy, setStepBy] = useState("1");
  const [everyMin, setEveryMin] = useState(DEFAULT_EVERY);
  const [windowStart, setWindowStart] = useState<string>(NUDGE_DEFAULT_WINDOW.start);
  const [windowEnd, setWindowEnd] = useState<string>(NUDGE_DEFAULT_WINDOW.end);
  const [enabled, setEnabled] = useState(true);
  const [editorError, setEditorError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<NudgeRow | null>(null);
  /** Cards with a write in flight, so a fast double tap cannot count from a stale number. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [push, setPush] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNote, setPushNote] = useState("");
  const [, setTick] = useState(0);
  const viewRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  const savingRef = useRef(false);
  useEnter(viewRef);

  const fields = JSON.stringify([
    title,
    description,
    target,
    unit,
    stepBy,
    everyMin,
    windowStart,
    windowEnd,
    enabled,
  ]);
  const [baseline, setBaseline] = useState(fields);
  const { dismiss } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    active: !!editor,
    onDismiss: saving ? false : () => setEditor(null),
    dirty: fields !== baseline,
  });

  useEffect(() => {
    let live = true;
    pushStatus()
      .then((status) => live && setPush(status))
      .catch(() => live && setPush({ supported: false, permission: "default", subscribed: false }));

    return () => {
      live = false;
    };
  }, []);

  /* The "Next" times are read against the clock, so redraw each minute. */
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);

    return () => clearInterval(timer);
  }, []);

  const editing = editor?.nudgeId ? nudges.find((n) => n.id === editor.nudgeId) : undefined;

  /** Per-card save state, from the queued writes for this nudge. */
  const syncOf = (id: string): "syncing" | "failed" | null => {
    const entries = pending.filter(
      (e) =>
        e.targetId === id ||
        (e.entity === "nudgeCheckIn" && (e.request.body as { nudgeId?: string }).nudgeId === id),
    );
    if (entries.some((e) => e.status === "failed" || e.status === "blocked")) return "failed";

    return entries.length ? "syncing" : null;
  };

  const openEditor = (row?: NudgeRow) => {
    const next = {
      title: row?.title ?? "",
      description: row?.description ?? "",
      target: String(row?.target ?? DEFAULT_TARGET),
      unit: row?.unit ?? "",
      stepBy: String(row?.step ?? 1),
      everyMin: row?.everyMin ?? DEFAULT_EVERY,
      windowStart: row?.windowStart ?? NUDGE_DEFAULT_WINDOW.start,
      windowEnd: row?.windowEnd ?? NUDGE_DEFAULT_WINDOW.end,
      enabled: row?.enabled ?? true,
    };
    setEditor({ nudgeId: row?.id ?? null });
    setTitle(next.title);
    setDescription(next.description);
    setTarget(next.target);
    setUnit(next.unit);
    setStepBy(next.stepBy);
    setEveryMin(next.everyMin);
    setWindowStart(next.windowStart);
    setWindowEnd(next.windowEnd);
    setEnabled(next.enabled);
    setBaseline(JSON.stringify(Object.values(next)));
    setEditorError("");
  };

  useImperativeHandle(ref, () => ({ openAdd: () => openEditor() }));

  /** Run one card's write, ignoring taps on that card until it lands. */
  const withBusy = async (id: string, work: () => Promise<unknown>) => {
    if (busy.has(id)) return;
    setBusy((prev) => new Set(prev).add(id));
    try {
      await work();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update nudge");
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(id);

        return next;
      });
    }
  };

  /** Move today's count by the nudge's step and say so when that reaches the goal. */
  const step = (row: NudgeRow, direction: 1 | -1) =>
    withBusy(row.id, async () => {
      if (!today) return;
      const before = countToday(row, today);
      const count = Math.max(0, before + direction * (row.step ?? 1));
      await nudge.recordCheckIn(row, direction);
      if (before < row.target && count >= row.target) {
        toast("Goal reached. Nudge paused until tomorrow");
      }
    });

  const setOn = (row: NudgeRow, on: boolean) =>
    withBusy(row.id, () => nudge.saveNudge({ ...row, enabled: on }));

  const turnOnPush = async () => {
    setPushBusy(true);
    setPushNote("");
    try {
      const result = await enablePush();
      if (!result.ok) setPushNote(PUSH_FAILURE_NOTE[result.reason] ?? PUSH_FAILURE_NOTE.failed!);
      setPush(await pushStatus());
    } catch {
      setPushNote(PUSH_FAILURE_NOTE.failed!);
    } finally {
      setPushBusy(false);
    }
  };

  const submitEditor = async () => {
    if (!editor || !today || savingRef.current) return;
    const goal = Number(target);
    if (!title.trim()) return setEditorError("A title is required");
    if (!Number.isInteger(goal) || goal < 1 || goal > 9999) {
      return setEditorError("The goal must be a whole number from 1 to 9999");
    }
    const stepGoal = Number(stepBy);
    if (!Number.isInteger(stepGoal) || stepGoal < 1 || stepGoal > 9999) {
      return setEditorError("Each tap must be a whole number from 1 to 9999");
    }
    if (toMinutes(windowStart) >= toMinutes(windowEnd)) {
      return setEditorError("The hours must end after they start");
    }

    savingRef.current = true;
    setSaving(true);
    setEditorError("");
    try {
      const fresh = {
        title: title.trim(),
        description: description.trim(),
        target: goal,
        unit: unit.trim(),
        step: stepGoal,
        everyMin,
        windowStart,
        windowEnd,
        enabled,
      };
      if (editing) {
        await nudge.saveNudge({ ...editing, ...fresh });
      } else {
        await nudge.saveNudge({
          ...fresh,
          progress: { day: today, count: 0 },
          createdAt: new Date().toISOString(),
        });
      }
      toast(editing ? "Nudge updated" : "Nudge added");
      setEditor(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not save nudge");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  useSearchReveal(["nudge"], (target) => {
    const row = nudges.find((row) => row.id === target.id);
    if (!row) return false;
    if (target.date) {
      setSearchDay({ id: row.id, day: target.date });
      focusSearchRecord(`nudge:${row.id}`);
    } else openEditor(row);
    return true;
  });

  if (nudge.loading) {
    return (
      <div ref={viewRef} className="view view-loading">
        <LoadingBloom />
      </div>
    );
  }

  if (!nudge.ready || !today || !timeZone) {
    return (
      <div ref={viewRef} className="view">
        <EmptyState
          title="Nudge isn't available offline yet"
          sub="Connect once to download your nudges."
        />
      </div>
    );
  }

  const pushNeeded = push !== null && !push.subscribed;

  return (
    <div ref={viewRef} className="view">
      {pushNeeded ? (
        <section className="panel nudge-notice" aria-live="polite">
          <span className="nudge-notice-icon" aria-hidden="true">
            <Icon name="bell" size={18} />
          </span>
          <div className="nudge-notice-copy">
            <h2>Notifications are off on this device</h2>
            <p>
              {push.supported
                ? "Nudges reach you as push notifications, even when Custos is closed. Turn them on for this device to start receiving them."
                : PUSH_FAILURE_NOTE.unsupported}
            </p>
            {pushNote ? (
              <p className="auth-error" role="alert">
                {pushNote}
              </p>
            ) : null}
          </div>
          {push.supported ? (
            <button
              className="primary-btn"
              type="button"
              disabled={pushBusy}
              onClick={() => void turnOnPush()}
            >
              {pushBusy ? "Turning on…" : "Turn on"}
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="panel" data-tour="tour-nudge-list">
        {nudges.length ? (
          <div className="nudge-grid">
            {nudges.map((row) => {
              const count = countToday(row, today);
              const met = goalMet(row, today);
              const sync = syncOf(row.id);
              const next = row.enabled && !met ? nextNudgeAt(row, Date.now(), timeZone) : null;

              return (
                <article
                  key={row.id}
                  data-search-id={`nudge:${row.id}`}
                  className={"nudge-card" + (met ? " met" : "") + (row.enabled ? "" : " off")}
                >
                  <header className="nudge-card-head">
                    <button
                      type="button"
                      className="daily-title nudge-title"
                      onClick={() => openEditor(row)}
                    >
                      <span className="nudge-name">{row.title}</span>
                      {row.description ? (
                        <span className="nudge-desc">{row.description}</span>
                      ) : null}
                    </button>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        disabled={busy.has(row.id)}
                        aria-label={`${row.title}: notifications ${row.enabled ? "on" : "off"}`}
                        onChange={(e) => void setOn(row, e.target.checked)}
                      />
                      <span className="toggle-ui" />
                    </label>
                  </header>

                  <NudgeBloom count={count} target={row.target} />
                  <div className="nudge-count" role="status">
                    <strong>{count}</strong>
                    <span>
                      of {row.target} {row.unit}
                    </span>
                  </div>
                  <progress
                    value={Math.min(count, row.target)}
                    max={row.target}
                    aria-label="Progress"
                  />

                  <div className="nudge-actions">
                    <button
                      className="ghost-btn"
                      type="button"
                      disabled={count === 0 || busy.has(row.id)}
                      aria-label={`${row.title}: remove ${row.step ?? 1}`}
                      onClick={() => void step(row, -1)}
                    >
                      <span aria-hidden="true">−</span> {row.step ?? 1}
                    </button>
                    <button
                      className="primary-btn"
                      type="button"
                      disabled={busy.has(row.id)}
                      aria-label={`${row.title}: add ${row.step ?? 1}`}
                      onClick={() => void step(row, 1)}
                    >
                      <span aria-hidden="true">+</span> {row.step ?? 1}
                    </button>
                  </div>

                  <p className="nudge-meta">
                    {everyLabel(row.everyMin)} · {fmtTime(row.windowStart)} to{" "}
                    {fmtTime(row.windowEnd)}
                    <br />
                    {!row.enabled
                      ? "Notifications are off"
                      : met
                        ? "Goal met today. Resumes tomorrow"
                        : `Next ${nextLabel(next!, timeZone, today)}`}
                    {sync ? (
                      <span className={"daily-sync" + (sync === "failed" ? " failed" : "")}>
                        {" "}
                        {sync === "failed" ? "Couldn't save" : "Syncing…"}
                      </span>
                    ) : null}
                  </p>

                  <NudgeHistory
                    key={searchDay?.id === row.id ? searchDay.day : row.id}
                    row={row}
                    today={today}
                    month={month}
                    initialDay={searchDay?.id === row.id ? searchDay.day : undefined}
                  />
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No nudges yet"
            sub="Add one for a habit like drinking water, stretching or checking your posture."
          />
        )}

        <div
          className={nudges.length ? "nudge-add" : "todo-empty-action"}
          data-tour="tour-nudge-add"
        >
          <button className="ghost-btn" type="button" onClick={() => openEditor()}>
            <Icon name="plus" size={15} /> Add nudge
          </button>
        </div>
      </section>

      {deleting ? (
        <ConfirmDialog
          title="Delete nudge"
          message={`Delete "${deleting.title}"? It stops notifying you, and all its check-in history is deleted.`}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await nudge.deleteNudge(deleting.id);
            setDeleting(null);
            setEditor(null);
            toast("Nudge deleted");
          }}
        />
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
                aria-labelledby="nudge-editor-title"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitEditor();
                }}
              >
                <div className="modal-head">
                  <h3 id="nudge-editor-title">{editing ? "Edit nudge" : "Add nudge"}</h3>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={dismiss}
                    aria-label="Close"
                    disabled={saving}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
                <div className="modal-body modal-scroll">
                  <div className="editor-fields">
                    <div className="editor-field">
                      <label className="fld-label" htmlFor="nudge-title">
                        Title
                      </label>
                      <input
                        id="nudge-title"
                        className="text-in wallet-field"
                        value={title}
                        maxLength={60}
                        autoFocus
                        placeholder="Drink water"
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </div>

                    <div className="editor-field">
                      <label className="fld-label" htmlFor="nudge-desc">
                        Description
                      </label>
                      <input
                        id="nudge-desc"
                        className="text-in wallet-field"
                        maxLength={160}
                        value={description}
                        placeholder="A glass of water, room temperature"
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>

                    <div className="editor-field">
                      <span className="fld-label" id="nudge-goal-label">
                        Daily goal
                      </span>
                      <div
                        className="nudge-goal-row"
                        role="group"
                        aria-labelledby="nudge-goal-label"
                      >
                        <input
                          className="text-in"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={9999}
                          value={target}
                          aria-label="Goal"
                          onChange={(e) => setTarget(e.target.value)}
                        />
                        <input
                          className="text-in"
                          value={unit}
                          maxLength={24}
                          placeholder="glasses"
                          aria-label="Unit"
                          onChange={(e) => setUnit(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="editor-field">
                      <label className="fld-label" htmlFor="nudge-step">
                        Each tap counts
                      </label>
                      <input
                        id="nudge-step"
                        className="text-in"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={9999}
                        value={stepBy}
                        onChange={(e) => setStepBy(e.target.value)}
                      />
                    </div>

                    <div className="editor-field">
                      <label className="fld-label" htmlFor="nudge-every">
                        Repeats
                      </label>
                      <div className="nudge-every">
                        <input
                          id="nudge-every"
                          type="range"
                          min={NUDGE_MIN_EVERY}
                          max={NUDGE_MAX_EVERY}
                          step={NUDGE_EVERY_STEP}
                          value={everyMin}
                          onChange={(e) => setEveryMin(Number(e.target.value))}
                        />
                        <output htmlFor="nudge-every">{everyLabel(everyMin)}</output>
                      </div>
                    </div>

                    <div className="editor-field">
                      <span className="fld-label" id="nudge-hours-label">
                        Only between
                      </span>
                      <div className="nudge-hours" role="group" aria-labelledby="nudge-hours-label">
                        <TimePicker value={windowStart} onChange={setWindowStart} />
                        <span aria-hidden="true">to</span>
                        <TimePicker value={windowEnd} onChange={setWindowEnd} />
                      </div>
                      <p className="fld-hint">
                        Notifications are checked every 15 minutes, so one can arrive a little late.
                        Once today&apos;s goal is met, it stays quiet until tomorrow.
                      </p>
                    </div>

                    {editorError ? (
                      <p className="auth-error auth-error--gap" role="alert">
                        {editorError}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="nudge-notify-section">
                  <div className="nudge-on-row">
                    <label className="fld-label" htmlFor="nudge-on">
                      Notify me
                    </label>
                    <label className="switch">
                      <input
                        id="nudge-on"
                        type="checkbox"
                        checked={enabled}
                        disabled={saving}
                        aria-describedby="nudge-notify-hint"
                        onChange={(e) => setEnabled(e.target.checked)}
                      />
                      <span className="toggle-ui" />
                    </label>
                  </div>
                  <p id="nudge-notify-hint" className="fld-hint">
                    When on, the server can read your title, goal and description to send
                    notifications. Counts, adjustments and units stay encrypted.
                  </p>
                </div>
                <div className="modal-foot">
                  {editing ? (
                    <button
                      className="ghost-btn danger"
                      type="button"
                      disabled={saving}
                      onClick={() => setDeleting(editing)}
                    >
                      Delete
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="mf-right">
                    <button className="ghost-btn" type="button" onClick={dismiss} disabled={saving}>
                      Cancel
                    </button>
                    <button
                      className="primary-btn"
                      type="submit"
                      disabled={saving || !title.trim()}
                    >
                      {saving ? "Saving…" : editing ? "Save changes" : "Add nudge"}
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
