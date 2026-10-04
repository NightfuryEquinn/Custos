import { useModalMotion } from "@/frontend/lib/animate";
import {
  MAX_MONTH_KEY,
  MIN_MONTH_KEY,
  TODAY_ISO,
  fmtTime,
  monthLabel,
  pad,
} from "@/frontend/lib/data";
import { CalendarBlank, CaretDown, CaretLeft, CaretRight, Clock } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const PICKER_ICONS = {
  calendar: CalendarBlank,
  clock: Clock,
  chevL: CaretLeft,
  chevR: CaretRight,
  chevD: CaretDown,
};

function PickerIcon({
  name,
  size = 16,
}: {
  name: "calendar" | "clock" | "chevL" | "chevR" | "chevD";
  size?: number;
}) {
  const Glyph = PICKER_ICONS[name];
  return <Glyph size={size} />;
}

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function usePickerPortal() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return { open, setOpen, rootRef, triggerRef, menuRef };
}

function getCalendarLayout(year: number, month: number) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const startOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  return { daysInMonth, startOffset };
}

/** Format an ISO date as y/m/d, or a placeholder when empty. */
function datePickerLabel(iso: string) {
  if (!iso) return "Optional";

  const [y, m, d] = iso.split("-").map(Number);

  return `${y}/${m}/${d}`;
}

/** Split HH:MM into 12-hour parts; an unset or malformed value opens the menu at 9:00 AM. */
function parseTime24(t: string) {
  const [hRaw, mRaw] = (t || "09:00").split(":").map(Number);
  const h = hRaw ?? 9;
  const m = mRaw ?? 0;
  const ap = h < 12 ? "AM" : "PM";
  const h12 = ((h + 11) % 12) + 1;
  return { h12, m, ap: ap as "AM" | "PM" };
}

function toTime24(h12: number, m: number, ap: "AM" | "PM") {
  let h = h12 % 12;
  if (ap === "PM") h += 12;
  return `${pad(h)}:${pad(m)}`;
}

function monthKey(y: number, m: number) {
  return `${y}-${pad(m)}`;
}

/** Split a "YYYY-MM-DD" (or "YYYY-MM") string into its year/month parts. */
function parseYearMonth(iso: string) {
  const [y, m] = iso.split("-").map(Number);

  return { y: y ?? new Date().getFullYear(), m: m ?? 1 };
}

type DatePickerProps = {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
};

export function DatePicker({ value, onChange, className }: DatePickerProps) {
  const { open, setOpen, rootRef, triggerRef, menuRef } = usePickerPortal();
  const scrimRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, menuRef, { variant: "picker", active: open });
  const seed = value || TODAY_ISO;
  const { y, m } = parseYearMonth(seed);
  const [viewY, setViewY] = useState(y);
  const [viewM, setViewM] = useState(m);

  useEffect(() => {
    const next = value || TODAY_ISO;
    const { y: vy, m: vm } = parseYearMonth(next);
    setViewY(vy);
    setViewM(vm);
  }, [value]);

  const viewKey = monthKey(viewY, viewM);
  const canPrev = viewKey > MIN_MONTH_KEY;
  const canNext = viewKey < MAX_MONTH_KEY;

  const goMonth = (delta: number) => {
    const d = new Date(viewY, viewM - 1 + delta, 1);
    const key = monthKey(d.getFullYear(), d.getMonth() + 1);
    if (key < MIN_MONTH_KEY || key > MAX_MONTH_KEY) return;
    setViewY(d.getFullYear());
    setViewM(d.getMonth() + 1);
  };

  const pickDay = (day: number) => {
    onChange(`${viewY}-${pad(viewM)}-${pad(day)}`);
    setOpen(false);
  };

  const { daysInMonth, startOffset } = getCalendarLayout(viewY, viewM);

  const menu = open ? (
    <div
      ref={scrimRef}
      className="picker-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose(() => setOpen(false));
      }}
    >
      <div ref={menuRef} className="picker-menu picker-menu--date" role="dialog" aria-modal="true">
        <div className="picker-cal-head">
          <button
            type="button"
            className="picker-nav-btn"
            disabled={!canPrev}
            onClick={() => goMonth(-1)}
            aria-label="Previous Month"
          >
            <PickerIcon name="chevL" />
          </button>
          <span className="picker-cal-title">{monthLabel(viewKey, true)}</span>
          <button
            type="button"
            className="picker-nav-btn"
            disabled={!canNext}
            onClick={() => goMonth(1)}
            aria-label="Next Month"
          >
            <PickerIcon name="chevR" />
          </button>
        </div>
        <div className="picker-cal-wd">
          {WD.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="picker-cal-grid">
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const pos = startOffset + i;
            const iso = `${viewY}-${pad(viewM)}-${pad(day)}`;
            const selected = iso === value;
            const today = iso === TODAY_ISO;
            return (
              <button
                key={day}
                type="button"
                className={"picker-cal-day" + (selected ? " active" : "") + (today ? " today" : "")}
                style={{ gridColumn: (pos % 7) + 1, gridRow: Math.floor(pos / 7) + 1 }}
                onClick={() => pickDay(day)}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className={"picker-wrap" + (className ? ` ${className}` : "")} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="picker-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={"picker-trigger-label" + (value ? "" : " is-placeholder")}>
          <PickerIcon name="calendar" />
          {datePickerLabel(value)}
        </span>
        <PickerIcon name="chevD" />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

type TimePickerProps = {
  value: string;
  onChange: (time: string) => void;
  className?: string;
  disabled?: boolean;
  /** Shown when `value` is empty (e.g. an end time that was never set). */
  placeholder?: string;
};

export function TimePicker({ value, onChange, className, disabled, placeholder }: TimePickerProps) {
  const { open, setOpen, rootRef, triggerRef, menuRef } = usePickerPortal();
  const scrimRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, menuRef, {
    variant: "picker",
    active: open && !disabled,
  });
  const parsed = parseTime24(value);
  const hourRef = useRef<HTMLButtonElement>(null);
  const minRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    hourRef.current?.scrollIntoView({ block: "center" });
    minRef.current?.scrollIntoView({ block: "center" });
  }, [open]);

  const setPart = (h12: number, m: number, ap: "AM" | "PM") => {
    onChange(toTime24(h12, m, ap));
  };

  const menu =
    open && !disabled ? (
      <div
        ref={scrimRef}
        className="picker-scrim"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) requestClose(() => setOpen(false));
        }}
      >
        <div
          ref={menuRef}
          className="picker-menu picker-menu--time"
          role="dialog"
          aria-modal="true"
        >
          <div className="picker-time-cols">
            <div className="picker-time-col">
              <span className="picker-time-label">Hour</span>
              <div className="picker-time-list">
                {HOURS.map((h) => (
                  <button
                    key={h}
                    ref={parsed.h12 === h ? hourRef : undefined}
                    type="button"
                    className={"picker-time-item" + (parsed.h12 === h ? " active" : "")}
                    onClick={() => setPart(h, parsed.m, parsed.ap)}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
            <div className="picker-time-col">
              <span className="picker-time-label">Min</span>
              <div className="picker-time-list">
                {MINUTES.map((m) => (
                  <button
                    key={m}
                    ref={parsed.m === m ? minRef : undefined}
                    type="button"
                    className={"picker-time-item num" + (parsed.m === m ? " active" : "")}
                    onClick={() => setPart(parsed.h12, m, parsed.ap)}
                  >
                    {pad(m)}
                  </button>
                ))}
              </div>
            </div>
            <div className="picker-time-col picker-time-col--ap">
              <span className="picker-time-label"> </span>
              <div className="picker-time-list">
                {(["AM", "PM"] as const).map((ap) => (
                  <button
                    key={ap}
                    type="button"
                    className={"picker-time-item" + (parsed.ap === ap ? " active" : "")}
                    onClick={() => setPart(parsed.h12, parsed.m, ap)}
                  >
                    {ap}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div className={"picker-wrap" + (className ? ` ${className}` : "")} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="picker-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className={"picker-trigger-label" + (value ? "" : " is-placeholder")}>
          <PickerIcon name="clock" />
          {value ? fmtTime(value) : (placeholder ?? "")}
        </span>
        <PickerIcon name="chevD" />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
