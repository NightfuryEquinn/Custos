import { DatePicker, TimePicker } from "@/frontend/components/DateTimePicker";
import { CategoryPicker } from "@/frontend/components/CategoryPicker";
import { useEnter, useModalMotion, useStagger } from "@/frontend/lib/animate";
import { FadeIn } from "@/frontend/components/FadeIn";
import {
  ConfirmDialog,
  DeleteScopeDialog,
  EmptyState,
  Icon,
  SummaryCard,
  glyphTint,
} from "@/frontend/components/ui";
import { CaretDown } from "@phosphor-icons/react";
import {
  CURRENT_MONTH_KEY,
  EVENT_CATS,
  REPEATS,
  TODAY_ISO,
  collapseRecurringToNext,
  dayLabel,
  eventCatMeta,
  eventDaysByMonth,
  eventSpanLabel,
  eventTimeLabel,
  fmtCommentTime,
  fmtMoney,
  fmtTime,
  getCurrency,
  leadLabel,
  leadTimesForEvent,
  monthLabel,
  repeatLabel,
  weekdayLabel,
} from "@/frontend/lib/data";
import type { EventDay } from "@/frontend/lib/data";
import { isActiveHoldOccurrence } from "@/frontend/lib/envelope-holds";
import { evaluateExpression, isPlainNumber } from "@/frontend/lib/arithmetic";
import { useAccountNotifyEmail } from "@/frontend/lib/hooks/useAccountNotifyEmail";
import type { CategoryIndex, EventComment, LedgerEvent } from "@/frontend/lib/types";
import type { DeleteScope } from "@/lib/delete-scope";
import { CATEGORY_GLYPH_OPTIONS, displayGlyph } from "@/lib/glyphs";
import { shiftIso } from "@/lib/schedule";
import { isRepeatAllowedForSpan, spanDaysBetween } from "@/schemas/common";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

/*
 * Schedule view
 * ─────────────
 *   Schedule   — month calendar + upcoming agenda
 *   EventModal — add / edit an event, incl. email-reminder opt-in
 */

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* EVENT_CATS always has a "custom" entry, so this is the safe default when an
 * event's own catId can't be resolved to a known category. */
const FALLBACK_CAT_META = EVENT_CATS.find((c) => c.id === "custom")!;

function normalizeLead(lead: string, allDay: boolean): string {
  const allowed = leadTimesForEvent(allDay);
  return allowed.some((l) => l.id === lead) ? lead : allDay ? "1d" : "at";
}

/** Default end time one hour after start, or empty when that would not be later. */
function defaultEndTimeAfter(time: string): string {
  const [hRaw, mRaw] = (time || "09:00").split(":").map(Number);
  const total = Math.min((hRaw ?? 9) * 60 + (mRaw ?? 0) + 60, 23 * 60 + 59);
  const next = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

  return next > time ? next : "";
}

function ChevDown({ size = 16 }: { size?: number }) {
  return <CaretDown size={size} aria-hidden />;
}

type LeadPickerProps = {
  options: ReadonlyArray<{ id: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
};

/** Custom dropdown for the email reminder lead time. */
function LeadPicker({ options, value, onChange }: LeadPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "picker", active: open });
  const selected = options.find((option) => option.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    activeRef.current?.scrollIntoView({ block: "nearest" });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!selected) return null;

  const menu = open ? (
    <div
      ref={scrimRef}
      className="picker-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose(() => setOpen(false));
      }}
    >
      <div
        ref={panelRef}
        className="picker-menu picker-menu--lead"
        role="listbox"
        aria-label="Reminder lead time"
      >
        <div className="picker-timezone-list">
          {options.map((option) => {
            const active = option.id === selected.id;

            return (
              <button
                key={option.id}
                ref={active ? activeRef : undefined}
                type="button"
                role="option"
                aria-selected={active}
                className={"picker-timezone-item" + (active ? " active" : "")}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
              >
                <span className="pti-label">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="picker-wrap" ref={rootRef}>
      <button
        type="button"
        className="picker-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="picker-trigger-label">{selected.label}</span>
        <ChevDown />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

function AgendaEventRow({
  day,
  currency,
  onEditEvent,
}: {
  day: EventDay<LedgerEvent>;
  currency: string;
  onEditEvent: (ev: LedgerEvent, occurrenceIso: string) => void;
}) {
  const { ev, startIso } = day;
  const c = eventCatMeta(ev) ?? FALLBACK_CAT_META;
  /*
   * The hold is reserved once for the whole run, so the badge belongs on the
   * first day only — repeating it would read as a charge every day.
   */
  const holdActive = day.dayIndex === 0 && isActiveHoldOccurrence(ev, startIso);
  const spanLabel = eventSpanLabel(day);
  return (
    <button type="button" className="agenda-row" onClick={() => onEditEvent(ev, startIso)}>
      <span className="ag-glyph" style={glyphTint(c.color)}>
        {displayGlyph(c.glyph, c.id)}
      </span>
      <span className="ag-main">
        <span className="ag-title">
          {ev.title}
          {ev.repeat !== "once" && (
            <span className="ag-rep" title={repeatLabel(ev)}>
              <Icon name="repeat" size={12} />
            </span>
          )}
          {holdActive ? (
            <span className="ag-hold" title="Budget hold active">
              <Icon name="lock" size={11} />
              {fmtMoney(ev.budgetHoldAmount ?? 0, { cents: false, currency })}
            </span>
          ) : null}
          {ev.comments && ev.comments.length > 0 && (
            <span className="ag-cmt">
              <Icon name="comment" size={12} /> {ev.comments.length}
            </span>
          )}
        </span>
        <span className="ag-sub">
          <span>{c.name}</span>
          {spanLabel ? <span className="ag-span">{spanLabel}</span> : null}
          {ev.notify ? (
            <span className="ag-bell">
              <Icon name="bell" size={11} />
              <span>{leadLabel(ev.lead, ev.allDay).toLowerCase()}</span>
            </span>
          ) : null}
        </span>
      </span>
      <span className="ag-time">{eventTimeLabel(ev, day)}</span>
    </button>
  );
}

// ── Schedule (calendar + agenda) ────────────────────────────────────
export function Schedule({
  events,
  month,
  currency,
  onAddEvent,
  onEditEvent,
}: {
  events: LedgerEvent[];
  month: string;
  currency: string;
  onAddEvent: (iso: string) => void;
  onEditEvent: (ev: LedgerEvent, occurrenceIso: string) => void;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y!, m!, 0).getDate();
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(days).padStart(2, "0")}`;
  const startOffset = (new Date(y!, m! - 1, 1).getDay() + 6) % 7; // Monday-first

  useEffect(() => {
    setSelectedDay(null);
  }, [month]);

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const isCurrent = month === CURRENT_MONTH_KEY;
  const byDay = useMemo(() => eventDaysByMonth(events, month), [events, month]);
  const occ = useMemo(() => {
    const out: Array<EventDay<LedgerEvent>> = [];
    for (const [, list] of byDay) out.push(...list);
    return out;
  }, [byDay]);
  /* Occurrence starts only — a 4-day event counts once toward the month total. */
  const occStarts = useMemo(() => occ.filter((o) => o.dayIndex === 0), [occ]);
  const agenda = isCurrent ? occ.filter((o) => o.iso >= TODAY_ISO) : occ;

  // Re-tick each minute so today's occurrence drops out of the agenda once it
  // has ended, handing the slot to the series' next occurrence.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  /** Agenda with each recurring series reduced to its next occurrence. */
  const upcoming = useMemo(
    () => (isCurrent ? collapseRecurringToNext(agenda, now) : agenda),
    [agenda, isCurrent, now],
  );

  const upcomingByDay = useMemo(() => {
    if (!isCurrent) return [];
    const groups = new Map<string, Array<EventDay<LedgerEvent>>>();
    for (const day of upcoming) {
      const list = groups.get(day.iso);
      if (list) list.push(day as EventDay<LedgerEvent>);
      else groups.set(day.iso, [day as EventDay<LedgerEvent>]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([iso, days]) => ({ iso, days }));
  }, [upcoming, isCurrent]);

  const nextRem = agenda.find((o) => o.ev.notify && o.dayIndex === 0);
  const alertsCount = occStarts.filter((o) => o.ev.notify).length;

  const defaultFocusDay =
    isCurrent && TODAY_ISO >= monthStart && TODAY_ISO <= monthEnd ? TODAY_ISO : monthStart;
  const viewDay = selectedDay ?? defaultFocusDay;
  const navAnchor = viewDay;

  const handleDayClick = (iso: string, dayEvents: Array<EventDay<LedgerEvent>>) => {
    if (dayEvents.length === 0) {
      onAddEvent(iso);
      return;
    }
    if (selectedDay === iso) {
      setSelectedDay(null);
      return;
    }
    setSelectedDay(iso);
  };

  const navigateDay = (delta: number) => {
    const next = shiftIso(navAnchor, delta);
    if (next < monthStart || next > monthEnd) return;
    setSelectedDay(next);
  };

  const showFullUpcoming = isCurrent && !selectedDay;
  const focusedEvents = showFullUpcoming ? [] : (byDay.get(viewDay) ?? []);
  const agendaEmpty = showFullUpcoming ? upcomingByDay.length === 0 : focusedEvents.length === 0;
  const canPrevDay = !showFullUpcoming && navAnchor > monthStart;
  const canNextDay = !showFullUpcoming && navAnchor < monthEnd;
  const upcomingTitle = isCurrent ? "Upcoming" : "Agenda";
  const viewRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useEnter(viewRef);
  useStagger(gridRef, ".summary-card");

  return (
    <div ref={viewRef} className="view">
      <div ref={gridRef} className="summary-grid sg-3" data-tour="tour-schedule-summary">
        <SummaryCard
          label="Events this Month"
          value={String(occStarts.length)}
          sub={monthLabel(month, true)}
        />
        <SummaryCard
          label="Next Reminder"
          tone="ok"
          value={nextRem ? dayLabel(nextRem.iso) : "—"}
          sub={
            nextRem
              ? `${nextRem.ev.title} · ${leadLabel(nextRem.ev.lead, nextRem.ev.allDay).toLowerCase()}`
              : "no upcoming reminders"
          }
        />
        <SummaryCard
          label="Email Reminders"
          value={String(alertsCount)}
          sub="occurrences will notify you"
        />
      </div>

      <section className="panel" data-tour="tour-schedule-agenda">
        <div className="panel-head panel-head--agenda">
          <div className="agenda-head">
            <button
              type="button"
              className="agenda-nav-btn"
              disabled={!canPrevDay}
              onClick={() => navigateDay(-1)}
              aria-label="Previous Day"
            >
              <Icon name="chevL" size={18} />
            </button>
            <div className="agenda-head-main">
              <h2>{upcomingTitle}</h2>
              <p className="panel-sub">
                {showFullUpcoming
                  ? `${upcoming.length} ${upcoming.length === 1 ? "event" : "events"} from ${dayLabel(TODAY_ISO)} · earliest first`
                  : `${dayLabel(viewDay)} · ${weekdayLabel(viewDay)} · ${focusedEvents.length} ${focusedEvents.length === 1 ? "event" : "events"}`}
              </p>
            </div>
            <button
              type="button"
              className="agenda-nav-btn"
              disabled={!canNextDay}
              onClick={() => navigateDay(1)}
              aria-label="Next Day"
            >
              <Icon name="chevR" size={18} />
            </button>
          </div>
        </div>
        <div className={"agenda" + (agendaEmpty ? " agenda--empty" : "")}>
          {showFullUpcoming ? (
            upcomingByDay.length ? (
              upcomingByDay.map(({ iso, days }) => (
                <div key={iso} className="agenda-group">
                  <div className="agenda-date">
                    <span className="agenda-dnum">{new Date(iso + "T00:00:00").getDate()}</span>
                    <span className="agenda-dwd">{weekdayLabel(iso)}</span>
                  </div>
                  <div className="agenda-items">
                    {days.map((day) => (
                      <AgendaEventRow
                        key={`${iso}-${day.ev.id}`}
                        day={day}
                        currency={currency}
                        onEditEvent={onEditEvent}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="No Upcoming Events"
                sub="Nothing scheduled from today onward — add an event or pick another day on the calendar."
              />
            )
          ) : focusedEvents.length ? (
            <div className="agenda-group">
              <div className="agenda-date">
                <span className="agenda-dnum">{new Date(viewDay + "T00:00:00").getDate()}</span>
                <span className="agenda-dwd">{weekdayLabel(viewDay)}</span>
              </div>
              <div className="agenda-items">
                {focusedEvents.map((day) => (
                  <AgendaEventRow
                    key={day.ev.id}
                    day={day}
                    currency={currency}
                    onEditEvent={onEditEvent}
                  />
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              title="No Events this Day"
              sub="Add something to this date, click the day again to show all upcoming, or use the arrows to browse."
            />
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{monthLabel(month, true)}</h2>
            <p className="panel-sub">Click a day to view or add · click an event to edit</p>
          </div>
          <button
            className="add-btn add-btn--top"
            onClick={() => onAddEvent(selectedDay ?? TODAY_ISO)}
          >
            <Icon name="plus" size={17} /> <span className="abt-txt">New Event</span>
          </button>
        </div>

        <div className="cal" data-tour="tour-schedule-cal">
          <div className="cal-wd">
            {WD.map((d) => (
              <div key={d} className="cal-wd-c">
                {d}
              </div>
            ))}
          </div>
          <div className="cal-grid">
            {cells.map((d, i) => {
              if (d === null) return <div key={i} className="cal-cell empty" />;
              const iso = `${month}-${String(d).padStart(2, "0")}`;
              const list = byDay.get(iso) ?? [];
              const today = iso === TODAY_ISO;
              const past = isCurrent && iso < TODAY_ISO;
              return (
                <div
                  key={i}
                  className={
                    "cal-cell" +
                    (today ? " today" : "") +
                    (past ? " past" : "") +
                    (viewDay === iso ? " selected" : "")
                  }
                  onClick={() => handleDayClick(iso, list)}
                >
                  <div className="cal-daynum">{d}</div>
                  <div className="cal-events">
                    {list.slice(0, 3).map((day) => {
                      const { ev, dayIndex, span } = day;
                      const c = eventCatMeta(ev) ?? FALLBACK_CAT_META;
                      /* Flatten the inner edges so a run reads as one bar. */
                      const runCls =
                        span === 1
                          ? ""
                          : dayIndex === 0
                            ? " cal-chip--run cal-chip--run-start"
                            : dayIndex === span - 1
                              ? " cal-chip--run cal-chip--run-end"
                              : " cal-chip--run cal-chip--run-mid";
                      const label =
                        dayIndex > 0
                          ? ev.title
                          : ev.allDay || !ev.time
                            ? ev.title
                            : `${fmtTime(ev.time)} ${ev.title}`;
                      return (
                        <button
                          key={ev.id}
                          className={"cal-chip" + runCls}
                          style={{ background: c.color + "1c", color: c.color }}
                          title={ev.title}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditEvent(ev, day.startIso);
                          }}
                        >
                          {dayIndex === 0 ? (
                            <span className="cal-chip-glyph">{displayGlyph(c.glyph, c.id)}</span>
                          ) : null}
                          <span className="cal-chip-txt">{label}</span>
                        </button>
                      );
                    })}
                    {list.length > 3 && <div className="cal-more">+{list.length - 3} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

type EventModalProps = {
  initial: LedgerEvent | null;
  defaultDate?: string;
  occurrenceIso?: string;
  hasLinkedPayment?: boolean;
  categoryIndex: CategoryIndex;
  currency: string;
  onSave: (data: LedgerEvent & { id?: string }) => void;
  onClose: () => void;
  onDelete: (id: string, opts?: { scope?: DeleteScope; fromDate?: string }) => void;
  onLogPayment?: (payment: { id: string; title: string; date: string; expenseId?: string }) => void;
};

// ── EventModal (add / edit event) ───────────────────────────────────
export function EventModal({
  initial,
  defaultDate,
  occurrenceIso,
  hasLinkedPayment = false,
  categoryIndex,
  currency,
  onSave,
  onClose,
  onDelete,
  onLogPayment,
}: EventModalProps) {
  const editing = !!(initial && initial.id);
  const customMeta = EVENT_CATS.find((c) => c.id === "custom")!;
  const accountNotifyEmail = useAccountNotifyEmail();

  const [title, setTitle] = useState(initial ? initial.title : "");
  const [catId, setCatId] = useState(initial ? initial.catId : "bill");
  const [customLabel, setCustomLabel] = useState(initial?.customLabel ?? "");
  const [customGlyph, setCustomGlyph] = useState(initial?.customGlyph ?? customMeta.glyph);
  const [date, setDate] = useState(initial ? initial.date : defaultDate || TODAY_ISO);
  const [endDate, setEndDate] = useState(
    initial?.endDate || initial?.date || defaultDate || TODAY_ISO,
  );
  const [allDay, setAllDay] = useState(initial ? !!initial.allDay : true);
  const [time, setTime] = useState(initial && initial.time ? initial.time : "09:00");
  /* Never seeded from the start time — an unset end time stays unset. */
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [repeat, setRepeat] = useState(initial ? initial.repeat : "once");
  // Email reminders are opt-in: new events start with notifications off,
  // matching the API schema default.
  const [notify, setNotify] = useState(initial ? !!initial.notify : false);
  const [lead, setLead] = useState(() =>
    normalizeLead(initial ? initial.lead : "1d", initial ? !!initial.allDay : true),
  );

  const [comments, setComments] = useState<EventComment[]>(
    initial && initial.comments ? initial.comments : [],
  );
  const [draft, setDraft] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = saving || deleting;
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });
  const [holdEnabled, setHoldEnabled] = useState(Boolean(initial?.budgetHoldEnabled));
  const [holdAmount, setHoldAmount] = useState(
    initial?.budgetHoldAmount ? String(initial.budgetHoldAmount) : "",
  );
  const [holdCategoryId, setHoldCategoryId] = useState(
    initial?.budgetHoldCategoryId ?? categoryIndex?.expenseCategories[0]?.id ?? "",
  );

  const paymentOccurrenceIso = occurrenceIso || initial?.date || date;

  const leadOptions = useMemo(() => leadTimesForEvent(allDay), [allDay]);
  const deleteFromDate = occurrenceIso || initial?.date || date;
  const showLogPayment = !!(editing && onLogPayment);

  const span = spanDaysBetween(date, endDate);
  const spanValid = endDate >= date;
  const endTimeValid = allDay || !endTime || endDate > date || (!!time && endTime > time);

  /*
   * A repeat is only offered while the next occurrence would start after this
   * one finishes; stretching the span past the active repeat resets it to Once
   * rather than silently promoting it to a different cadence.
   */
  const repeatAllowed = useCallback(
    (id: string) => isRepeatAllowedForSpan(id as never, span),
    [span],
  );
  useEffect(() => {
    if (repeat !== "once" && !repeatAllowed(repeat)) setRepeat("once");
  }, [repeat, repeatAllowed]);

  /** Keep the end on or after the start when the start moves. */
  const handleDateChange = (next: string) => {
    setDate(next);
    if (endDate < next) setEndDate(shiftIso(next, span - 1));
  };

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (titleRef.current) titleRef.current.focus();
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !scopeOpen && !confirmOpen && !busy) requestClose(onClose);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [scopeOpen, confirmOpen, busy, onClose, requestClose]);

  /** Toggle all-day: clear the end time, or seed it one hour after start. */
  const handleAllDayChange = (checked: boolean) => {
    setAllDay(checked);
    if (checked) {
      setEndTime("");
    } else {
      setEndTime(defaultEndTimeAfter(time));
    }
    if (!leadTimesForEvent(checked).some((l) => l.id === lead)) {
      setLead(checked ? "1d" : "at");
    }
  };

  const chooseCat = (id: string) => {
    setCatId(id);
    if (id === "custom" && !customGlyph) setCustomGlyph(customMeta.glyph);
  };

  const addComment = () => {
    const t = draft.trim();
    if (!t) return;
    setComments((cs) => [...cs, { id: "c" + Date.now(), text: t, at: new Date().toISOString() }]);
    setDraft("");
  };

  /** Remove a comment from local modal state (persists on Save). */
  const removeComment = (id: string) => {
    setComments((cs) => cs.filter((c) => c.id !== id));
  };

  const customOk = catId !== "custom" || (customLabel.trim() && customGlyph);
  const holdAmountEvaluated = evaluateExpression(holdAmount);
  const holdAmountIsExpression = holdAmountEvaluated !== null && !isPlainNumber(holdAmount);
  const holdAmountNum = Math.max(0, Math.round(holdAmountEvaluated ?? 0));
  const resolvedHoldCategoryId = holdCategoryId || categoryIndex?.expenseCategories[0]?.id || "";
  const holdValid = !holdEnabled || (holdAmountNum > 0 && resolvedHoldCategoryId);
  const valid =
    title.trim() && date && (allDay || time) && customOk && holdValid && spanValid && endTimeValid;
  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const holdFields =
        holdEnabled && holdAmountNum > 0 && resolvedHoldCategoryId
          ? {
              budgetHoldEnabled: true,
              budgetHoldAmount: holdAmountNum,
              budgetHoldCategoryId: resolvedHoldCategoryId,
              budgetHoldReleasedDates: initial?.budgetHoldReleasedDates,
            }
          : {
              budgetHoldEnabled: false,
            };
      await onSave({
        /* Empty id (rather than omitted) still reads as "new" downstream — data.id is checked for truthiness. */
        id: initial?.id ?? "",
        title: title.trim(),
        catId,
        customLabel: catId === "custom" ? customLabel.trim() : undefined,
        customGlyph: catId === "custom" ? customGlyph : undefined,
        date,
        /* Both null for a plain single-day event, so its payload is unchanged. */
        endDate: endDate > date ? endDate : null,
        allDay,
        time: allDay ? null : time,
        endTime: allDay || !endTime ? null : endTime,
        repeat,
        notify,
        lead,
        email: "",
        comments,
        ...holdFields,
      });
    } finally {
      setSaving(false);
    }
  };

  /** Start delete — ask for scope when recurring, otherwise confirm once. */
  const requestDelete = () => {
    if (!initial?.id || deleting) return;
    if (initial.repeat && initial.repeat !== "once") {
      setScopeOpen(true);
      return;
    }
    setConfirmOpen(true);
  };

  /** Confirm a scoped recurring event delete. */
  const confirmScopedDelete = async (scope: DeleteScope) => {
    if (!initial?.id) return;
    await onDelete(initial.id, { scope, fromDate: deleteFromDate });
    setScopeOpen(false);
  };

  return (
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !scopeOpen && !confirmOpen && !busy)
          requestClose(onClose);
      }}
    >
      <div ref={panelRef} className="modal sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{editing ? "Edit Event" : "New Event"}</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={() => requestClose(onClose)}
            aria-label="Close"
            disabled={busy}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="modal-body modal-scroll">
          <input
            ref={titleRef}
            className="ev-title-in"
            type="text"
            placeholder="Event title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />

          <div className="event-div" />
          <label className="fld-label">Type</label>
          <div className="cat-grid">
            {EVENT_CATS.filter((c) => c.id !== "custom").map((c) => (
              <button
                key={c.id}
                type="button"
                className={"cat-chip" + (catId === c.id ? " active" : "")}
                style={
                  catId === c.id ? { borderColor: c.color, background: c.color + "16" } : undefined
                }
                onClick={() => chooseCat(c.id)}
              >
                <span className="cc-glyph" style={{ color: c.color }}>
                  {displayGlyph(c.glyph, c.id)}
                </span>
                <span className="cc-label">{c.name}</span>
              </button>
            ))}
            <button
              type="button"
              className={"cat-chip cat-chip--span2" + (catId === "custom" ? " active" : "")}
              style={
                catId === "custom"
                  ? { borderColor: customMeta.color, background: customMeta.color + "16" }
                  : undefined
              }
              onClick={() => chooseCat("custom")}
            >
              <span className="cc-glyph" style={{ color: customMeta.color }}>
                {displayGlyph(customGlyph || customMeta.glyph, "custom")}
              </span>
              <span className="cc-label">{customLabel.trim() || "Custom type"}</span>
            </button>
          </div>

          {catId === "custom" ? (
            <div className="ev-custom">
              <label className="fld-label" htmlFor="ev-custom-name">
                Custom type name
              </label>
              <input
                id="ev-custom-name"
                className="text-in"
                type="text"
                placeholder="e.g. Team sync, Vet visit"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                maxLength={40}
              />
              <label className="fld-label">Emoji</label>
              <div className="cat-glyph-row">
                {CATEGORY_GLYPH_OPTIONS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={"cat-glyph-btn" + (customGlyph === g ? " active" : "")}
                    style={
                      customGlyph === g
                        ? { borderColor: customMeta.color, color: customMeta.color }
                        : undefined
                    }
                    onClick={() => setCustomGlyph(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="event-div" />

          <div className="fld-2col">
            <div>
              <label className="fld-label">Starts</label>
              <DatePicker value={date} onChange={handleDateChange} />
            </div>
            <div>
              <label className="fld-label">Time</label>
              {allDay ? (
                <div className="time-allday">All day</div>
              ) : (
                <TimePicker value={time} onChange={setTime} />
              )}
            </div>
          </div>

          <div className="fld-2col">
            <div>
              <label className="fld-label">Ends</label>
              <DatePicker value={endDate} onChange={setEndDate} />
            </div>
            <div>
              <label className="fld-label">End time</label>
              {allDay ? (
                <div className="time-allday">All day</div>
              ) : endTime ? (
                <div className="end-time-row">
                  <TimePicker value={endTime} onChange={setEndTime} />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setEndTime("")}
                    aria-label="Clear End Time"
                  >
                    <Icon name="close" size={15} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="ghost-btn end-time-add"
                  onClick={() => setEndTime(defaultEndTimeAfter(time))}
                >
                  <Icon name="plus" size={14} /> End time
                </button>
              )}
            </div>
          </div>
          {!spanValid ? (
            <p className="fld-error">End date cannot be before the start date.</p>
          ) : !endTimeValid ? (
            <p className="fld-error">End time must be after the start time.</p>
          ) : span > 1 ? (
            <p className="fld-hint">Runs for {span} days.</p>
          ) : null}

          <label className="toggle-line tight">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => handleAllDayChange(e.target.checked)}
            />
            <span className="toggle-ui" /> <span>All-day event</span>
          </label>

          <div className="event-div" />
          <label className="fld-label">Repeats</label>
          <div className="sub-row">
            {REPEATS.map((r) => {
              const allowed = repeatAllowed(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  className={"sub-chip" + (repeat === r.id ? " active" : "")}
                  disabled={!allowed}
                  title={
                    allowed
                      ? undefined
                      : `A ${span}-day event can't repeat ${r.label.toLowerCase()}`
                  }
                  onClick={() => setRepeat(r.id)}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          {span > 1 ? (
            <p className="fld-hint">Repeats that would overlap a {span}-day run are unavailable.</p>
          ) : null}
          <div className="event-div" />
          <div className="notify-head">
            <label className="toggle-line tight">
              <input
                type="checkbox"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
              />
              <span className="toggle-ui" />{" "}
              <span>
                <Icon name="bell" size={15} /> Email reminder
              </span>
            </label>
          </div>
          {notify && (
            <div className="notify-card">
              <div className="notify-fields">
                <div>
                  <label className="fld-label">Send</label>
                  <LeadPicker options={leadOptions} value={lead} onChange={setLead} />
                </div>
                <p className="notify-send-to">
                  Send to {accountNotifyEmail || "Set your email in Data & privacy"}
                </p>
              </div>
              <p className="notify-note">
                Reminders go to your account email only — set it under Data &amp; privacy.
              </p>
              <p className="notify-note">
                You'll always get a reminder right at the event itself — the start time, or 9:00 AM
                on the day for all-day events — this lead time is an extra one sent earlier.
              </p>
              <p className="notify-note">
                The email includes this event's name, budget hold and comments. Email is not
                encrypted, so a readable copy is stored for delivery until you turn reminders off.
              </p>
            </div>
          )}
          <div className="event-div" />

          <div className="notify-head">
            <label className="toggle-line tight">
              <input
                type="checkbox"
                checked={holdEnabled}
                onChange={(e) => setHoldEnabled(e.target.checked)}
              />
              <span className="toggle-ui" />
              <span>
                <Icon name="lock" size={15} /> Hold from budget
              </span>
            </label>
          </div>
          {holdEnabled ? (
            <div className="notify-card">
              <div className="fld-2col tight hold-fields-grid">
                <div className="hold-fields-grid__amount">
                  <label className="fld-label">Amount</label>
                  {holdAmountIsExpression ? (
                    <FadeIn className="amount-live-total">
                      = {fmtMoney(holdAmountEvaluated, { cents: false, currency })}
                    </FadeIn>
                  ) : null}
                  <div className="hold-amt-row">
                    <span className="hold-cur">{getCurrency(currency).symbol}</span>
                    <input
                      className="text-in"
                      type="text"
                      inputMode="text"
                      placeholder="0"
                      value={holdAmount}
                      onChange={(e) => setHoldAmount(e.target.value)}
                      onBlur={() => {
                        if (holdAmountIsExpression) setHoldAmount(String(holdAmountEvaluated));
                      }}
                    />
                  </div>
                </div>
                <div className="hold-fields-grid__category">
                  <label className="fld-label">Category</label>
                  <CategoryPicker
                    categories={categoryIndex.expenseCategories}
                    value={resolvedHoldCategoryId}
                    onChange={setHoldCategoryId}
                  />
                </div>
              </div>
            </div>
          ) : null}
          <div className="event-div" />

          <label className="fld-label">Comments</label>
          <div className="cmt-thread">
            {comments.length ? (
              comments.map((c) => (
                <div key={c.id} className="cmt">
                  <div className="cmt-row">
                    <div className="cmt-bubble">{c.text}</div>
                    <button
                      className="cmt-remove"
                      type="button"
                      onClick={() => removeComment(c.id)}
                      aria-label="Delete comment"
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                  <div className="cmt-time">{fmtCommentTime(c.at)}</div>
                </div>
              ))
            ) : (
              <div className="cmt-empty">No comments yet — add a note, context, or follow-up.</div>
            )}
            <div className="cmt-composer">
              <input
                className="cmt-in"
                type="text"
                placeholder="Add a comment…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addComment();
                  }
                }}
              />
              <button
                className="cmt-send"
                type="button"
                disabled={!draft.trim()}
                onClick={addComment}
                aria-label="Post Comment"
              >
                <Icon name="send" size={17} />
              </button>
            </div>
          </div>
        </div>

        <div className={"modal-foot" + (showLogPayment ? " modal-foot-stacked" : "")}>
          {showLogPayment ? (
            <div className="mf-row mf-row-full">
              <button
                className="ghost-btn danger"
                type="button"
                disabled={deleting}
                onClick={requestDelete}
              >
                <span className="btn-label">{deleting ? "Deleting…" : "Delete"}</span>
              </button>
              <button
                className="ghost-btn"
                type="button"
                onClick={() => {
                  if (!initial || !onLogPayment) return;
                  onLogPayment({
                    id: initial.id,
                    title: title.trim() || initial.title,
                    date: paymentOccurrenceIso,
                    expenseId: hasLinkedPayment ? initial.expenseId : undefined,
                  });
                }}
              >
                <span className="btn-label">
                  {hasLinkedPayment ? "View Linked Payment" : "Log Payment"}
                </span>
              </button>
            </div>
          ) : editing ? (
            <button
              className="ghost-btn danger"
              type="button"
              disabled={deleting}
              onClick={requestDelete}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          ) : (
            <span />
          )}
          <div className="mf-right">
            <button
              className="ghost-btn"
              type="button"
              onClick={() => requestClose(onClose)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="primary-btn"
              type="button"
              disabled={!valid || saving}
              onClick={submit}
            >
              {saving ? "Saving…" : editing ? "Save Changes" : "Add Event"}
            </button>
          </div>
        </div>
      </div>
      {scopeOpen && initial?.id ? (
        <DeleteScopeDialog
          title="Delete Recurring Event"
          onCancel={() => setScopeOpen(false)}
          onConfirm={confirmScopedDelete}
        />
      ) : null}
      {confirmOpen && initial?.id ? (
        <ConfirmDialog
          title="Delete Event"
          message={`Delete "${title.trim() || initial.title}"? This cannot be undone.`}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await onDelete(initial.id);
            } finally {
              setDeleting(false);
            }
            setConfirmOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
