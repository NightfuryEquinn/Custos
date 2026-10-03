import { ReadableValue } from "@/frontend/components/ReadableValue";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useFadeIn } from "@/frontend/lib/animate";

type DonutDatum = { id: string; value: number; color: string; label?: string };

type DonutProps = {
  data: DonutDatum[];
  size?: number;
  thickness?: number;
  onHover?: (id: string | null) => void;
  activeId?: string | null;
};

/** Fade-in wrapper for chart hover tooltips. */
function ChartTip({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFadeIn(ref);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

function Donut({ data, size = 220, thickness = 30, onHover, activeId }: DonutProps) {
  // data: [{id,label,value,color}]
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = size / 2;
  const r = R - thickness / 2;
  const C = 2 * Math.PI * r;
  let acc = 0;
  const segs = data.map((d) => {
    const frac = d.value / total;
    const seg = { ...d, frac, offset: acc, dash: frac * C };
    acc += frac;
    return seg;
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${R} ${R})`}>
        {segs.map((s) => {
          const dim = activeId && activeId !== s.id;
          return (
            <circle
              key={s.id}
              cx={R}
              cy={R}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={activeId === s.id ? thickness + 4 : thickness}
              strokeDasharray={`${Math.max(s.dash - 1.5, 0)} ${C - Math.max(s.dash - 1.5, 0)}`}
              strokeDashoffset={-s.offset * C}
              strokeLinecap="butt"
              opacity={dim ? 0.32 : 1}
              style={{ transition: "opacity .2s, stroke-width .2s, r .2s", cursor: "pointer" }}
              onMouseEnter={() => onHover && onHover(s.id)}
              onMouseLeave={() => onHover && onHover(null)}
              onTouchStart={() => onHover && onHover(s.id)}
            />
          );
        })}
      </g>
    </svg>
  );
}

/** Compact axis label: 12000 -> "12K", 800 -> "800". */
function axisShort(v: number) {
  if (v >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "K";
  return String(v);
}

/**
 * Round a max value up to a clean axis ceiling (1/2/4/5/8 × 10ⁿ) so the four
 * gridline labels land on readable numbers. Shared by every chart with a y-axis.
 */
function axisCeil(v: number) {
  if (!(v > 0)) return 100;
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 4 ? 4 : norm <= 5 ? 5 : norm <= 8 ? 8 : 10;

  return mult * mag;
}

type AxisProps = {
  padL: number;
  padR: number;
  padT: number;
  innerH: number;
  width: number;
  max: number;
};

/** Horizontal gridlines with left-hand value labels — the shared chart y-axis. */
function AxisGrid({ padL, padR, padT, innerH, width, max }: AxisProps) {
  return (
    <>
      {[0, 0.25, 0.5, 0.75, 1].map((g) => {
        const gy = padT + innerH * (1 - g);

        return (
          <g key={g}>
            {g > 0 && (
              <line
                x1={padL}
                x2={width - padR}
                y1={gy}
                y2={gy}
                stroke="var(--hair)"
                strokeWidth="1"
              />
            )}
            <text
              x={padL - 6}
              y={gy}
              dy="3"
              fontSize="10"
              fill="var(--ink-faint)"
              textAnchor="end"
              fontFamily="var(--font-mono)"
            >
              {axisShort(Math.round(max * g))}
            </text>
          </g>
        );
      })}
    </>
  );
}

/**
 * Place a tooltip over a chart at horizontal position `frac` (0–1), pinning it
 * to the container edge near the ends so it never overflows the panel.
 */
function tipAnchor(frac: number): CSSProperties {
  const pct = Math.max(0, Math.min(1, frac)) * 100;
  if (pct <= 24) return { left: 0 };
  if (pct >= 76) return { right: 0 };

  return { left: `${pct}%`, transform: "translateX(-50%)" };
}

/** Longest tooltip breakdown before the rest is folded into a "+N more" row. */
const TIP_ROWS = 5;

/** One line of a day's spend or income: a category and its combined total. */
type FlowEntry = {
  id: string;
  name: string;
  color: string;
  glyph: string;
  amount: number;
  count: number;
};

/** Hover detail for a single trend point. */
type TrendDetail = {
  /** Heading, e.g. "Sun, Aug 9". */
  label: string;
  spent: number;
  earned: number;
  spend: FlowEntry[];
  earn: FlowEntry[];
};

type TipSectionProps = {
  title: string;
  total: number;
  entries: FlowEntry[];
  dotColor?: string;
  dotClass?: string;
  empty: string;
  format: (n: number) => string;
};

/** Total + per-source rows for one side (spend or income) of a tooltip. */
function TipSection({ title, total, entries, dotColor, dotClass, empty, format }: TipSectionProps) {
  const shown = entries.slice(0, TIP_ROWS);
  const rest = entries.length - shown.length;

  return (
    <div className="ctip-block">
      <div className="ctip-line">
        <span className="ctip-key">
          <i
            className={"trend-dot" + (dotClass ? " " + dotClass : "")}
            style={dotColor ? { background: dotColor } : undefined}
          />
          {title}
        </span>
        <ReadableValue as="span" className="ctip-total">
          {format(total)}
        </ReadableValue>
      </div>
      {shown.length ? (
        <ul className="ctip-list">
          {shown.map((entry) => (
            <li key={entry.id}>
              <span className="ctip-glyph" aria-hidden="true">
                {entry.glyph}
              </span>
              <span className="ctip-name">{entry.name}</span>
              {entry.count > 1 ? <span className="ctip-count">×{entry.count}</span> : null}
              <ReadableValue as="span" className="ctip-amt">
                {format(entry.amount)}
              </ReadableValue>
            </li>
          ))}
          {rest > 0 ? <li className="ctip-more">+{rest} more</li> : null}
        </ul>
      ) : (
        <p className="ctip-empty">{empty}</p>
      )}
    </div>
  );
}

type TrendPoint = { x: string; v: number };

type AreaTrendProps = {
  points: TrendPoint[];
  width?: number;
  height?: number;
  accent: string;
  budgetLine?: number;
  showDots?: boolean;
  /** Optional second series, drawn as a plain line over the main area. */
  compare?: TrendPoint[] | null;
  compareAccent?: string;
  /** Per-point category breakdown; enables the hover tooltip when provided. */
  details?: TrendDetail[] | null;
  /** Money formatter for tooltip amounts. */
  format?: (n: number) => string;
};

function AreaTrend({
  points,
  width = 720,
  height = 200,
  accent,
  budgetLine,
  showDots,
  compare = null,
  compareAccent = "var(--ok)",
  details = null,
  format = (n: number) => String(Math.round(n)),
}: AreaTrendProps) {
  const [hover, setHover] = useState<number | null>(null);
  const padL = 34,
    padR = 8,
    padT = 14,
    padB = 22;
  const W = width,
    H = height;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const cmp = compare && compare.length ? compare : null;
  const maxV = Math.max(
    budgetLine || 0,
    ...points.map((p) => p.v),
    ...(cmp ? cmp.map((p) => p.v) : []),
    1,
  );
  const nice = axisCeil(maxV);
  const xAt = (i: number, len: number) =>
    padL + (len === 1 ? innerW / 2 : (i / (len - 1)) * innerW);
  const x = (i: number) => xAt(i, points.length);
  const y = (v: number) => padT + innerH - (v / nice) * innerH;
  const pathOf = (pts: TrendPoint[]) =>
    pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i, pts.length).toFixed(1)},${y(p.v).toFixed(1)}`)
      .join(" ");
  const line = pathOf(points);
  const cmpLine = cmp ? pathOf(cmp) : null;
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  const gid = "ag" + Math.round((accent || "").length + width);
  const hoverIdx = details && hover !== null && hover < points.length ? hover : null;
  const detail = hoverIdx === null ? null : details![hoverIdx];
  const hoverPoint = hoverIdx === null ? null : points[hoverIdx];
  const hoverCmp = hoverIdx === null || !cmp ? null : cmp[hoverIdx];
  const bandW = points.length > 1 ? innerW / (points.length - 1) : innerW;

  const chart = (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.26" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <AxisGrid padL={padL} padR={padR} padT={padT} innerH={innerH} width={W} max={nice} />
      {budgetLine ? (
        <line
          x1={padL}
          x2={W - padR}
          y1={y(budgetLine)}
          y2={y(budgetLine)}
          stroke="var(--ink-soft)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          opacity="0.6"
        />
      ) : null}
      <path d={area} fill={`url(#${gid})`} />
      {cmpLine ? (
        <path
          d={cmpLine}
          fill="none"
          stroke={compareAccent}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      <path
        d={line}
        fill="none"
        stroke={accent}
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {showDots &&
        cmp &&
        cmp.map((p, i) => (
          <circle
            key={"c" + i}
            cx={xAt(i, cmp.length)}
            cy={y(p.v)}
            r="3"
            fill="var(--surface)"
            stroke={compareAccent}
            strokeWidth="2"
          />
        ))}
      {showDots &&
        points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.v)}
            r="3"
            fill="var(--surface)"
            stroke={accent}
            strokeWidth="2"
          />
        ))}
      {/* hovered day: guide line + emphasized markers */}
      {hoverIdx !== null ? (
        <g pointerEvents="none">
          <line
            x1={x(hoverIdx)}
            x2={x(hoverIdx)}
            y1={padT}
            y2={padT + innerH}
            stroke="var(--ink-faint)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          {hoverCmp ? (
            <circle
              cx={xAt(hoverIdx, cmp!.length)}
              cy={y(hoverCmp.v)}
              r="4"
              fill="var(--surface)"
              stroke={compareAccent}
              strokeWidth="2.5"
            />
          ) : null}
          {hoverPoint ? (
            <circle
              cx={x(hoverIdx)}
              cy={y(hoverPoint.v)}
              r="4"
              fill="var(--surface)"
              stroke={accent}
              strokeWidth="2.5"
            />
          ) : null}
        </g>
      ) : null}
      {/* x labels (sparse) */}
      {points.map((p, i) => {
        const step = Math.ceil(points.length / 8);
        if (i % step !== 0 && i !== points.length - 1) return null;
        return (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            fontSize="10"
            fill="var(--ink-faint)"
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            fontFamily="var(--font-mono)"
          >
            {p.x}
          </text>
        );
      })}
      {/* invisible hit bands, one per day */}
      {details
        ? points.map((_, i) => {
            const bx = Math.max(padL, x(i) - bandW / 2);
            return (
              <rect
                key={"hit" + i}
                x={bx}
                y={padT}
                width={Math.min(bandW, W - padR - bx)}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onTouchStart={() => setHover(i)}
              />
            );
          })
        : null}
    </svg>
  );

  if (!details) return chart;

  return (
    <div className="chart-hoverable" onMouseLeave={() => setHover(null)}>
      {chart}
      {detail ? (
        <ChartTip className="chart-tip" style={tipAnchor(x(hoverIdx!) / W)}>
          <div className="ctip-day">{detail.label}</div>
          <TipSection
            title="Spent"
            total={detail.spent}
            entries={detail.spend}
            dotColor={accent}
            empty="Nothing spent"
            format={format}
          />
          <TipSection
            title="Earned"
            total={detail.earned}
            entries={detail.earn}
            dotClass="trend-dot--earn"
            empty="Nothing earned"
            format={format}
          />
        </ChartTip>
      ) : null}
    </div>
  );
}

type MoMBar = { key: string; label: string; spent: number; earned?: number };

type MoMBarsProps = {
  months: MoMBar[];
  accent: string;
  height?: number;
  activeKey?: string;
  onSelect?: (key: string) => void;
  budget?: number;
  /** Money formatter for the hover tooltip. */
  format?: (n: number) => string;
};

function MoMBars({
  months,
  accent,
  height = 220,
  activeKey,
  onSelect,
  budget,
  format = (n: number) => String(Math.round(n)),
}: MoMBarsProps) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 720,
    H = height;
  // padL matches AreaTrend so both charts carry the same y-axis gutter.
  const padL = 34,
    padR = 8,
    padT = 16,
    padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const nice = axisCeil(Math.max(budget || 0, ...months.map((m) => m.spent), 1));
  const slot = innerW / months.length;
  const bw = Math.min(slot * 0.5, 54);
  const y = (v: number) => padT + innerH - (v / nice) * innerH;
  const cxOf = (i: number) => padL + slot * i + slot / 2;
  const hovered = hover ? months.find((m) => m.key === hover) : null;
  const hoveredX = hovered ? cxOf(months.indexOf(hovered)) : 0;

  return (
    <div className="chart-hoverable" onMouseLeave={() => setHover(null)}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
        <AxisGrid padL={padL} padR={padR} padT={padT} innerH={innerH} width={W} max={nice} />
        {budget ? (
          <line
            x1={padL}
            x2={W - padR}
            y1={y(budget)}
            y2={y(budget)}
            stroke="var(--ink-soft)"
            strokeDasharray="4 4"
            strokeWidth="1.5"
            opacity="0.55"
          />
        ) : null}
        {months.map((m, i) => {
          const cx = cxOf(i);
          const active = m.key === activeKey;
          const hot = m.key === hover;
          const h = innerH - (y(m.spent) - padT);
          const labelEvery =
            months.length > 24 ? 5 : months.length > 14 ? 3 : months.length > 8 ? 2 : 1;
          const showLabel = i % labelEvery === 0 || i === months.length - 1;
          return (
            <g
              key={m.key}
              style={{ cursor: "pointer" }}
              onClick={() => onSelect && onSelect(m.key)}
              onMouseEnter={() => setHover(m.key)}
              onTouchStart={() => setHover(m.key)}
            >
              {/* full-height hit slot so thin bars stay easy to hover */}
              <rect x={cx - slot / 2} y={padT} width={slot} height={innerH} fill="transparent" />
              <rect
                x={cx - bw / 2}
                y={y(m.spent)}
                width={bw}
                height={Math.max(h, 1)}
                rx="6"
                fill={accent}
                opacity={active || hot ? 1 : 0.32}
                style={{ transition: "opacity .2s" }}
              />
              {showLabel ? (
                <text
                  x={cx}
                  y={H - 9}
                  fontSize="11"
                  textAnchor="middle"
                  fill={active || hot ? "var(--ink)" : "var(--ink-faint)"}
                  fontFamily="var(--font-mono)"
                  fontWeight={active || hot ? 700 : 400}
                >
                  {m.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hovered ? (
        <ChartTip className="chart-tip chart-tip--brief" style={tipAnchor(hoveredX / W)}>
          <div className="ctip-day">{hovered.label}</div>
          <div className="ctip-line">
            <span className="ctip-key">
              <i className="trend-dot" style={{ background: accent }} /> Total Spend
            </span>
            <ReadableValue as="span" className="ctip-total">
              {format(hovered.spent)}
            </ReadableValue>
          </div>
          <div className="ctip-line">
            <span className="ctip-key">
              <i className="trend-dot trend-dot--earn" /> Total Income
            </span>
            <ReadableValue as="span" className="ctip-total">
              {format(hovered.earned || 0)}
            </ReadableValue>
          </div>
          <div className="ctip-line ctip-line--net">
            <span className="ctip-key">Net</span>
            <span
              className={
                "ctip-total" + ((hovered.earned || 0) - hovered.spent < 0 ? " is-down" : " is-up")
              }
            >
              {format((hovered.earned || 0) - hovered.spent)}
            </span>
          </div>
        </ChartTip>
      ) : null}
    </div>
  );
}

function MiniSpark({
  values,
  color,
  width = 90,
  height = 28,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...values, 1),
    min = Math.min(...values, 0);
  const rng = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - 2 - ((v - min) / rng) * (height - 4);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height}>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export { AreaTrend, Donut, MiniSpark, MoMBars };
