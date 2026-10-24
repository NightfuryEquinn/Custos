import { useState } from "react";
import { monthLog, type Nudge } from "@/lib/nudge";
import { monthLabel } from "@/frontend/lib/data";
import { weekdayOf } from "@/lib/daily";

export function NudgeBloom({ count, target }: { count: number; target: number }) {
  const petals = Math.min(8, Math.floor((count / target) * 8));
  return (
    <svg
      className="nudge-bloom"
      viewBox="0 0 160 160"
      role="img"
      aria-label={`${count} of ${target}; ${Math.round((count / target) * 100)} percent complete`}
    >
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

export function NudgeHistory({ row, today, month }: { row: Nudge; today: string; month: string }) {
  const [selectedDay, setDay] = useState<string | null>(null);
  const day = selectedDay?.startsWith(month)
    ? selectedDay
    : today.startsWith(month)
      ? today
      : `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  const counts = Object.fromEntries(monthLog(row, month));
  return (
    <div className="nudge-history">
      <h3>{monthLabel(month, true)}</h3>
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
              style={index === 0 ? { gridColumnStart: weekdayOf(date) + 1 } : undefined}
              className={`nudge-calendar-day${count >= row.target ? " met" : count > 0 ? " growing" : ""}`}
              aria-pressed={date === day}
              disabled={date > today}
              aria-label={`${date}: ${count} ${row.unit}`}
              onClick={() => setDay(date)}
            >
              {index + 1}
              {count > 0 ? <span aria-hidden="true">{count >= row.target ? "✓" : "·"}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="nudge-calendar-total" role="status">
        <strong>{day}</strong>
        <span>
          {counts[day] ?? 0} {row.unit}
        </span>
      </div>
      <p className="panel-sub">
        Shading shows progress toward your current goal of {row.target} {row.unit}.
      </p>
    </div>
  );
}
