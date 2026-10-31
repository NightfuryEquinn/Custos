import { useState } from "react";
import { monthLog, type Nudge } from "@/lib/nudge";
import { monthLabel } from "@/frontend/lib/data";
import { weekdayOf } from "@/lib/daily";
import { Icon } from "./ui";

export function NudgeBloom({ count, target }: { count: number; target: number }) {
  const petals = Math.min(8, Math.floor((count / target) * 8));
  return (
    <svg className="nudge-bloom" viewBox="0 0 160 160" aria-hidden="true" focusable="false">
      <path d="M80 88 Q72 120 84 151" fill="none" stroke="currentColor" strokeWidth="3" />
      <ellipse
        cx="67"
        cy="123"
        rx="17"
        ry="7"
        transform="rotate(30 67 123)"
        className="bloom-leaf"
      />
      <ellipse
        cx="91"
        cy="138"
        rx="16"
        ry="6"
        transform="rotate(-25 91 138)"
        className="bloom-leaf"
      />
      {Array.from({ length: 8 }, (_, i) => (
        <ellipse
          key={i}
          cx="80"
          cy="43"
          rx="13"
          ry="26"
          transform={`rotate(${i * 45} 80 76)`}
          className={i < petals ? "bloom-petal grown" : "bloom-petal"}
        />
      ))}
      <circle cx="80" cy="76" r="16" className="bloom-heart" />
    </svg>
  );
}

export function NudgeHistory({
  row,
  today,
  month: initialMonth,
  initialDay,
}: {
  row: Nudge;
  today: string;
  month: string;
  initialDay?: string;
}) {
  const [month, setMonth] = useState(initialDay?.slice(0, 7) ?? initialMonth);
  const [selectedDay, setDay] = useState<string | null>(initialDay ?? null);
  const day = selectedDay?.startsWith(month)
    ? selectedDay
    : today.startsWith(month)
      ? today
      : `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  const counts = Object.fromEntries(monthLog(row, month));
  const earliest = [
    row.createdAt.slice(0, 7),
    row.progress.day.slice(0, 7),
    ...Object.keys(row.history ?? {}).map((date) => date.slice(0, 7)),
  ].sort()[0]!;
  const browse = (direction: number) => {
    const date = new Date(Date.UTC(year!, monthNumber! - 1 + direction, 1));
    setMonth(date.toISOString().slice(0, 7));
    setDay(null);
  };
  return (
    <div className="nudge-history">
      <div className="nudge-history-head">
        <h3 aria-live="polite">{monthLabel(month, true)}</h3>
        <div className="nudge-history-nav">
          <button
            type="button"
            className="icon-btn"
            aria-label={`${row.title}: previous month`}
            disabled={month <= earliest}
            onClick={() => browse(-1)}
          >
            <Icon name="chevL" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`${row.title}: next month`}
            disabled={month >= today.slice(0, 7)}
            onClick={() => browse(1)}
          >
            <Icon name="chevR" size={16} />
          </button>
        </div>
      </div>
      <div className="nudge-calendar-scroll">
        <div className="nudge-calendar" aria-label={`${row.title}: ${monthLabel(month, true)}`}>
          {["M", "T", "W", "T", "F", "S", "S"].map((label, index) => (
            <span key={index} aria-hidden="true">
              {label}
            </span>
          ))}
          {Array.from({ length: days }, (_, index) => {
            const date = `${month}-${String(index + 1).padStart(2, "0")}`;
            const count = counts[date] ?? 0;
            return (
              <button
                type="button"
                key={date}
                data-search-id={`nudge:${row.id}:${date}`}
                style={index === 0 ? { gridColumnStart: weekdayOf(date) + 1 } : undefined}
                className={`nudge-calendar-day${count >= row.target ? " met" : count > 0 ? " growing" : ""}`}
                aria-pressed={date === day}
                disabled={date > today}
                aria-label={`${date}: ${count} ${row.unit}`}
                onClick={() => setDay(date)}
              >
                {index + 1}
                {count > 0 ? (
                  <span aria-hidden="true">{count >= row.target ? "✓" : "·"}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="nudge-calendar-total" role="status">
        <strong>{day}</strong>
        <span>
          {counts[day] ?? 0} {row.unit}
        </span>
      </div>
      <p className="panel-sub">
        Shading uses your current goal: {row.target} {row.unit}.
      </p>
    </div>
  );
}
