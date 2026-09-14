import { Brand } from "@/frontend/components/Brand";
import { DatePicker } from "@/frontend/components/DateTimePicker";
import { FadeIn } from "@/frontend/components/FadeIn";
import { useFadeIn, useModalMotion } from "@/frontend/lib/animate";
import { evaluateExpression, isPlainNumber } from "@/frontend/lib/arithmetic";
import { isSavingsCategory, pickerSubs } from "@/frontend/lib/categories";
import {
  CURRENT_MONTH_KEY,
  MAX_MONTH_KEY,
  MIN_MONTH_KEY,
  TODAY_ISO,
  clampMonthKey,
  fmtMoney,
  getCurrency,
  monthLabel,
  monthRangeBounds,
  pad,
  weekdayLabel,
} from "@/frontend/lib/data";
import type { Insight } from "@/frontend/lib/insights/types";
import {
  Archive,
  ArrowsClockwise,
  Bell,
  Calculator as CalculatorIcon,
  CalendarBlank,
  Car,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  ChartBar,
  ChartPieSlice,
  Check,
  ChatCircle,
  Clock,
  Copy,
  Database,
  DotsThree,
  DownloadSimple,
  File,
  Info,
  Key,
  ListBullets,
  ListChecks,
  Lock,
  MagnifyingGlass,
  Moon,
  PaperPlaneTilt,
  PencilSimple,
  PiggyBank,
  Plus,
  Repeat,
  ShieldCheck,
  SignOut,
  Sparkle,
  SquaresFour,
  Sun,
  Tag,
  Target,
  WifiHigh,
  WifiSlash,
  Trash,
  Wallet as WalletIcon,
  X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { isRecurring, normalizeRecurring, recurringLabel } from "@/frontend/lib/stats";
import type {
  CapitalPlan,
  CategoryIndex,
  Expense,
  FinancialWallet,
  MonthEntry,
  RecurringInterval,
  ViewId,
} from "@/frontend/lib/types";
import { displayGlyph } from "@/lib/glyphs";
import type { DeleteScope } from "@/lib/delete-scope";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/*
 * Shared UI primitives
 * ────────────────────
 *   Icon, CatGlyph, glyphTint  — visual atoms
 *   Sidebar, MonthSwitcher   — navigation
 *   SummaryCard, TransactionRow — data display
 *   Segmented, EmptyState    — controls & placeholders
 *   AddExpenseModal          — add / edit transaction
 *   DeleteScopeDialog        — recurring delete scope chooser
 *   ConfirmDialog            — generic yes/no confirmation
 */

type DeleteExpenseOpts = { scope?: DeleteScope; fromDate?: string };

const DELETE_SCOPE_OPTIONS: { v: DeleteScope; label: string; note: string }[] = [
  { v: "this", label: "This Only", note: "Remove just this occurrence." },
  { v: "future", label: "All Futures Only", note: "Remove this and every later occurrence." },
  { v: "all", label: "Both Past and Future", note: "Remove the entire series." },
];

/** Confirm which recurring occurrences to delete. */
function DeleteScopeDialog({
  title = "Delete Recurring",
  onConfirm,
  onCancel,
}: {
  title?: string;
  onConfirm: (scope: DeleteScope) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<DeleteScope>("this");
  const [busy, setBusy] = useState(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) requestClose(onCancel);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [busy, onCancel, requestClose]);

  /** Confirm the selected delete scope. */
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(scope);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) requestClose(onCancel);
      }}
    >
      <div
        ref={panelRef}
        className="modal sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-scope-title"
      >
        <div className="modal-head">
          <h3 id="delete-scope-title">{title}</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={() => requestClose(onCancel)}
            aria-label="Close"
            disabled={busy}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="dm-lead">
            Choose how much of this series to remove. This cannot be undone.
          </p>
          <div className="delete-scope-list" role="radiogroup" aria-label="Delete Scope">
            {DELETE_SCOPE_OPTIONS.map((o) => (
              <label key={o.v} className={"delete-scope-option" + (scope === o.v ? " active" : "")}>
                <input
                  type="radio"
                  name="delete-scope"
                  value={o.v}
                  checked={scope === o.v}
                  onChange={() => setScope(o.v)}
                />
                <span className="delete-scope-copy">
                  <span className="delete-scope-label">{o.label}</span>
                  <span className="delete-scope-note">{o.note}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button
            className="ghost-btn"
            type="button"
            onClick={() => requestClose(onCancel)}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="ghost-btn danger" type="button" onClick={confirm} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Generic yes/no confirmation before a destructive action. */
function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  pendingLabel = "Deleting…",
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  pendingLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) requestClose(onCancel);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [busy, onCancel, requestClose]);

  /** Confirm the pending action. */
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) requestClose(onCancel);
      }}
    >
      <div
        ref={panelRef}
        className="modal sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="modal-head">
          <h3 id="confirm-dialog-title">{title}</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={() => requestClose(onCancel)}
            aria-label="Close"
            disabled={busy}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="dm-lead">{message}</p>
        </div>
        <div className="modal-foot">
          <button
            className="ghost-btn"
            type="button"
            onClick={() => requestClose(onCancel)}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className={"ghost-btn" + (danger ? " danger" : "")}
            type="button"
            onClick={confirm}
            disabled={busy}
          >
            {busy ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Inline style for a category glyph badge: colored icon on a translucent
 * tint of the same color. Category colors are user data, so this is the
 * one sanctioned use of inline styles in the app.
 */
function glyphTint(color: string) {
  return { color, background: color + "1f" };
}

// ── Icon: Phosphor icon set, looked up by name ───────────────────────
const ICON_MAP: Record<string, PhosphorIcon> = {
  overview: SquaresFour,
  list: ListBullets,
  budget: ChartPieSlice,
  calculator: CalculatorIcon,
  insights: ChartBar,
  recurring: ArrowsClockwise,
  plus: Plus,
  close: X,
  chevL: CaretLeft,
  chevR: CaretRight,
  edit: PencilSimple,
  trash: Trash,
  archive: Archive,
  search: MagnifyingGlass,
  repeat: Repeat,
  shield: ShieldCheck,
  key: Key,
  copy: Copy,
  check: Check,
  wallet: WalletIcon,
  logout: SignOut,
  chevD: CaretDown,
  chevU: CaretUp,
  download: DownloadSimple,
  database: Database,
  more: DotsThree,
  calendar: CalendarBlank,
  clock: Clock,
  bell: Bell,
  comment: ChatCircle,
  send: PaperPlaneTilt,
  checklist: ListChecks,
  tags: Tag,
  moon: Moon,
  sun: Sun,
  file: File,
  info: Info,
  lock: Lock,
  sparkle: Sparkle,
  piggy: PiggyBank,
  capital: Target,
  car: Car,
  "wifi-on": WifiHigh,
  "wifi-off": WifiSlash,
};

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const Glyph = ICON_MAP[name];
  if (!Glyph) return null;
  return <Glyph size={size} />;
}

// ── CatGlyph: category / type emoji marker ──────────────────────────
function CatGlyph({ glyph, id }: { glyph?: string; id?: string }) {
  return (
    <span className="cat-glyph-inline" aria-hidden>
      {displayGlyph(glyph, id)}
    </span>
  );
}

/** One entry per view: [id, label, icon]. Shared by Sidebar; mobile uses TAB_BAR_ITEMS + MORE_NAV_ITEMS. */
export const NAV_ITEMS = [
  ["overview", "Overview", "overview"],
  ["todos", "TO-DO List", "checklist"],
  ["schedule", "Schedule", "calendar"],
  ["transactions", "Transactions", "list"],
  ["budgets", "Budgets", "budget"],
  ["recurring", "Recurring", "recurring"],
  ["vehicles", "Vehicles", "car"],
  ["categories", "Categories", "tags"],
  ["piggies", "Piggies", "piggy"],
  ["capitals", "Capitals", "capital"],
  ["calculator", "Calculator", "calculator"],
  ["insights", "Insights", "insights"],
  ["transparency", "Transparency", "database"],
] as const;

/** Primary mobile tab bar entries (the rest live in the More sheet). */
export const TAB_BAR_ITEMS = [
  ["overview", "Overview", "overview"],
  ["schedule", "Schedule", "calendar"],
  ["transactions", "Transactions", "list"],
  ["todos", "To-Do", "checklist"],
] as const satisfies ReadonlyArray<readonly [ViewId, string, string]>;

const TAB_BAR_IDS = new Set<ViewId>(TAB_BAR_ITEMS.map(([id]) => id));

/** Views reachable from the mobile More sheet. */
export const MORE_NAV_ITEMS = NAV_ITEMS.filter(([id]) => !TAB_BAR_IDS.has(id));

const MORE_VIEW_IDS = new Set<ViewId>(MORE_NAV_ITEMS.map(([id]) => id));

// ── Sidebar (desktop navigation) ────────────────────────────────────
function Sidebar({ view, setView }: { view: ViewId; setView: (id: ViewId) => void }) {
  const items = NAV_ITEMS;
  return (
    <aside className="sidebar">
      <Brand variant="sidebar" />
      <nav className="nav">
        {items.map(([id, label, icon]) => (
          <button
            key={id}
            data-tour={`tour-nav-${id}`}
            className={"nav-item" + (view === id ? " active" : "")}
            onClick={() => setView(id)}
          >
            <Icon name={icon} size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

/** Mobile tab bar (5 slots) plus a bottom sheet for the remaining views. */
function MobileBottomNav({ view, setView }: { view: ViewId; setView: (id: ViewId) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const moreActive = MORE_VIEW_IDS.has(view);
  const { requestClose } = useModalMotion(scrimRef, panelRef, {
    variant: "sheet",
    active: moreOpen,
  });

  /** Close the sheet when navigation changes. */
  useEffect(() => {
    setMoreOpen(false);
  }, [view]);

  /** Trap body scroll while the More sheet is open. */
  useEffect(() => {
    if (!moreOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose(() => setMoreOpen(false));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [moreOpen, requestClose]);

  const pickView = (id: ViewId) => {
    setView(id);
    setMoreOpen(false);
  };

  const moreSheet = moreOpen
    ? createPortal(
        <div
          ref={scrimRef}
          className="modal-scrim nav-more-scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) requestClose(() => setMoreOpen(false));
          }}
        >
          <div
            ref={panelRef}
            className="modal nav-more-panel"
            role="dialog"
            aria-label="More navigation"
          >
            <div className="nav-more-head">
              <h3>More</h3>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                onClick={() => requestClose(() => setMoreOpen(false))}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="nav-more-grid">
              {MORE_NAV_ITEMS.map(([id, label, icon]) => (
                <button
                  key={id}
                  type="button"
                  data-tour={`tour-nav-${id}`}
                  className={"nav-more-item" + (view === id ? " active" : "")}
                  onClick={() => pickView(id)}
                >
                  <Icon name={icon} size={22} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <nav className="bottom-nav" aria-label="Main navigation">
        {TAB_BAR_ITEMS.map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            data-tour={`tour-nav-${id}`}
            className={"bn-item" + (view === id ? " active" : "")}
            onClick={() => {
              setMoreOpen(false);
              setView(id);
            }}
            aria-label={label}
            aria-current={view === id ? "page" : undefined}
          >
            <Icon name={icon} size={21} />
            <span className="bn-label">{label}</span>
          </button>
        ))}
        <button
          type="button"
          data-tour="tour-nav-more"
          className={"bn-item" + (moreActive || moreOpen ? " active" : "")}
          onClick={() => setMoreOpen((open) => !open)}
          aria-label="More"
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
        >
          <Icon name="more" size={21} />
          <span className="bn-label">More</span>
        </button>
      </nav>
      {moreSheet}
    </>
  );
}

// ── MonthSwitcher: prev / label picker / next ─────────────────────
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Viewport height left below a fixed dropdown, keeping the bottom nav clear. */
function dropdownMaxHeightPx(anchorBottom: number) {
  const bottomNav = window.matchMedia("(max-width: 860px)").matches ? 92 : 16;

  return Math.max(140, Math.round(window.innerHeight - anchorBottom - bottomNav));
}

/** True when a scroll started inside the open dropdown (do not dismiss). */
function scrollIsInsideMenu(menu: HTMLElement | null, target: EventTarget | null) {
  return !!(menu && target instanceof Node && (target === menu || menu.contains(target)));
}

function MonthSwitcher({
  months,
  current,
  onChange,
  changing = false,
}: {
  months: MonthEntry[];
  current: string;
  onChange: (key: string) => void;
  /** True while the month PATCH is in flight, from the profile mutation. */
  changing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<Record<string, string | number>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pickY, setPickY] = useState(() => Number(current.split("-")[0]));
  // Bounds come from parsing fixed MIN/MAX_MONTH_KEY constants — always well-formed,
  // but the split/map gives numbers TS can't prove are present without a fallback.
  const { minY = 0, maxY = 9999 } = monthRangeBounds();

  useEffect(() => {
    setPickY(Number(current.split("-")[0]));
  }, [current]);

  /** Fire onChange, ignoring clicks while a month PATCH is still in flight. */
  const requestChange = (key: string) => {
    if (changing) return;
    onChange(key);
  };

  const idx = months.findIndex((m) => m.key === current);
  const go = (d: number) => {
    const n = idx + d;
    const next = n >= 0 && n < months.length ? months[n] : undefined;
    if (next) requestChange(next.key);
  };

  const placeMenu = () => {
    const el = labelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuW = 280;
    let left = r.left + r.width / 2 - menuW / 2;
    if (left + menuW > window.innerWidth - 12) left = window.innerWidth - menuW - 12;
    if (left < 12) left = 12;
    const top = r.bottom + 8;

    setMenuStyle({
      position: "fixed",
      top,
      left,
      width: menuW,
      maxHeight: dropdownMaxHeightPx(top),
      zIndex: 60,
    });
  };

  useEffect(() => {
    if (!open) return;
    placeMenu();
    const onScroll = (e: Event) => {
      if (scrollIsInsideMenu(menuRef.current, e.target)) return;
      setOpen(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  const pickMonth = (month: number) => {
    requestChange(clampMonthKey(`${pickY}-${pad(month)}`));
    setOpen(false);
  };

  const goYear = (delta: number) => {
    const nextY = pickY + delta;
    if (nextY < minY || nextY > maxY) return;
    setPickY(nextY);
  };

  const canPrevYear = pickY > minY;
  const canNextYear = pickY < maxY;
  useFadeIn(menuRef, { active: open });

  const picker = open ? (
    <div
      ref={menuRef}
      className="month-pick-menu"
      style={menuStyle}
      role="dialog"
      aria-modal="true"
    >
      <div className="picker-cal-head">
        <button
          type="button"
          className="picker-nav-btn"
          disabled={!canPrevYear}
          onClick={() => goYear(-1)}
          aria-label="Previous Year"
        >
          <Icon name="chevL" size={16} />
        </button>
        <span className="picker-cal-title">{pickY}</span>
        <button
          type="button"
          className="picker-nav-btn"
          disabled={!canNextYear}
          onClick={() => goYear(1)}
          aria-label="Next Year"
        >
          <Icon name="chevR" size={16} />
        </button>
      </div>
      <div className="month-pick-grid">
        {MONTH_SHORT.map((label, i) => {
          const month = i + 1;
          const key = `${pickY}-${pad(month)}`;
          const enabled = key >= MIN_MONTH_KEY && key <= MAX_MONTH_KEY;
          const active = key === current;
          const today = key === CURRENT_MONTH_KEY;
          return (
            <button
              key={label}
              type="button"
              className={
                "month-pick-cell" + (active ? " active" : "") + (today && !active ? " today" : "")
              }
              disabled={!enabled || changing}
              onClick={() => pickMonth(month)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div className="month-switch" data-tour="tour-month" ref={rootRef}>
      <button
        className="msbtn"
        disabled={idx <= 0 || changing}
        onClick={() => go(-1)}
        aria-label="Previous Month"
      >
        <Icon name="chevL" size={18} />
      </button>
      <button
        ref={labelRef}
        className="ms-label-btn"
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="calendar" size={15} />
        <span>{monthLabel(current, true)}</span>
        <Icon name="chevD" size={14} />
      </button>
      <button
        className="msbtn"
        disabled={idx >= months.length - 1 || changing}
        onClick={() => go(1)}
        aria-label="Next Month"
      >
        <Icon name="chevR" size={18} />
      </button>
      {picker ? createPortal(picker, document.body) : null}
    </div>
  );
}

// ── SummaryCard: labeled stat with optional tone accent ─────────────
function SummaryCard({
  label,
  value,
  sub,
  tone,
  foot,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
  foot?: ReactNode;
}) {
  return (
    <div className={"summary-card" + (tone ? " tone-" + tone : "")}>
      <div className="sc-label">{label}</div>
      <div className="sc-value">{value}</div>
      {sub ? <div className="sc-sub">{sub}</div> : null}
      {foot ? <div className="sc-foot">{foot}</div> : null}
    </div>
  );
}

// ── TransactionRow: single expense/income line item ─────────────────
function TransactionRow({
  exp,
  onEdit,
  onDelete,
  currency,
  walletName,
  categoryIndex,
}: {
  exp: Expense;
  onEdit: (exp: Expense) => void;
  onDelete: (id: string, opts?: DeleteExpenseOpts) => void | Promise<void>;
  currency?: string;
  walletName?: string;
  categoryIndex: CategoryIndex;
}) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const sub = categoryIndex.subById[exp.sub];
  const cat = sub ? categoryIndex.catById[sub.catId] : null;
  if (!sub || !cat) return null;

  /** Start delete — ask for scope when recurring, otherwise confirm once. */
  const requestDelete = () => {
    if (isRecurring(exp)) {
      setScopeOpen(true);
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <div className="txn">
      <div className="txn-date">
        <div className="txn-day">{new Date(exp.date + "T00:00:00").getDate()}</div>
        <div className="txn-wd">{weekdayLabel(exp.date)}</div>
      </div>
      <div className="txn-glyph" style={glyphTint(cat.color)}>
        {displayGlyph(cat.glyph, cat.id)}
      </div>
      <div className="txn-main">
        <div className="txn-note">
          {exp.note}
          {isRecurring(exp) ? (
            <span className="txn-rep" title={recurringLabel(exp.recurring)}>
              <Icon name="repeat" size={13} />
            </span>
          ) : null}
        </div>
        <div className="txn-cat">
          {cat.name} · {sub.name}
          {walletName ? <span className="txn-wallet"> · {walletName}</span> : null}
        </div>
      </div>
      <div className={"txn-amt" + (exp.kind === "income" ? " income" : " expense")}>
        {exp.kind === "income" ? "+" : "−"}
        {fmtMoney(exp.amount, { currency })}
      </div>
      <div className="txn-actions">
        <button onClick={() => onEdit(exp)} aria-label="Edit">
          <Icon name="edit" size={16} />
        </button>
        <button onClick={requestDelete} aria-label="Delete" disabled={deleting}>
          <Icon name="trash" size={16} />
        </button>
      </div>
      {scopeOpen ? (
        <DeleteScopeDialog
          title="Delete Recurring Transaction"
          onCancel={() => setScopeOpen(false)}
          onConfirm={async (scope) => {
            await onDelete(exp.id, { scope, fromDate: exp.date });
            setScopeOpen(false);
          }}
        />
      ) : null}
      {confirmOpen ? (
        <ConfirmDialog
          title="Delete Transaction"
          message="Delete this transaction? This cannot be undone."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await onDelete(exp.id);
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

// ── Segmented: pill-style option switch ──────────────────────────────
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { v: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.v}
          className={"seg-btn" + (value === o.v ? " active" : "")}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── EmptyState: centered placeholder for empty lists ────────────────
function EmptyState({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark">◌</div>
      <div className="empty-title">{title}</div>
      {sub ? <div className="empty-sub">{sub}</div> : null}
    </div>
  );
}

// ── InsightFeed: ranked findings, shared by Transaction and Fuel Insights ──
/** One ranked finding card — tone stripe, optional metric chip, confidence pill. */
function InsightCard({ insight }: { insight: Insight }) {
  return (
    <article className={"insight-card tone-" + insight.tone}>
      <div className="insight-card-head">
        <span className="insight-card-title">{insight.title}</span>
        <span className={"profile-confidence conf-" + insight.confidence.level}>
          {insight.confidence.level}
        </span>
      </div>
      {insight.metric ? (
        <div className="insight-card-metric">
          <span className="insight-card-metric-label">{insight.metric.label}</span>
          <span className="insight-card-metric-value">{insight.metric.value}</span>
        </div>
      ) : null}
      <p className="insight-card-body">{insight.body}</p>
    </article>
  );
}

/** Render a ranked insight feed, or a quiet empty state when nothing stands out. */
function InsightFeed({
  insights,
  emptyLabel = "Nothing stands out right now.",
}: {
  insights: Insight[];
  emptyLabel?: string;
}) {
  if (!insights.length) {
    return <p className="panel-sub insight-feed-empty">{emptyLabel}</p>;
  }

  return (
    <div className="insight-feed">
      {insights.map((insight) => (
        <InsightCard key={insight.id} insight={insight} />
      ))}
    </div>
  );
}

type WalletPickerProps = {
  wallets: FinancialWallet[];
  value: string;
  onChange: (id: string) => void;
  onManage?: () => void;
  className?: string;
};

function WalletPicker({ wallets, value, onChange, onManage, className }: WalletPickerProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<Record<string, string | number>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = wallets.find((w) => w.id === value) ?? wallets[0];

  const placeMenu = () => {
    const chip = chipRef.current;
    if (!chip) return;
    const r = chip.getBoundingClientRect();
    const top = r.bottom + 8;

    setMenuStyle({
      position: "fixed",
      top,
      left: r.left,
      right: "auto",
      minWidth: Math.max(r.width, 220),
      maxHeight: dropdownMaxHeightPx(top),
      zIndex: 60,
    });
  };

  useEffect(() => {
    if (!open) return;
    placeMenu();
    const onScroll = (e: Event) => {
      if (scrollIsInsideMenu(menuRef.current, e.target)) return;
      setOpen(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  useFadeIn(menuRef, { active: open });

  if (!selected) return null;

  const menu = open ? (
    <div ref={menuRef} className="wallet-menu" style={menuStyle}>
      {wallets.map((w) => {
        const cur = getCurrency(w.currency);
        return (
          <button
            key={w.id}
            type="button"
            className={"wallet-menu-item" + (w.id === selected.id ? " active" : "")}
            onClick={() => {
              onChange(w.id);
              setOpen(false);
            }}
          >
            <span className="wmi-name">{w.name}</span>
            <span className="wmi-cur num">
              {cur.code} · {cur.symbol}
            </span>
          </button>
        );
      })}
      {onManage ? (
        <>
          <div className="am-div" />
          <button
            type="button"
            className="wallet-menu-item manage"
            onClick={() => {
              onManage();
              setOpen(false);
            }}
          >
            <Icon name="edit" size={15} /> Manage Wallets
          </button>
        </>
      ) : null}
    </div>
  ) : null;

  return (
    <div
      className={"wallet-switch" + (className ? ` ${className}` : "")}
      data-tour="tour-wallet"
      ref={rootRef}
    >
      <button
        ref={chipRef}
        className="wallet-chip"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="wallet" size={16} />
        <span className="wallet-chip-name">{selected.name}</span>
        <span className="wallet-chip-cur num">{selected.currency}</span>
        <Icon name="chevD" size={14} />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

// ── Add / edit expense modal ────────────────────────────────────────
/**
 * `lockedSub` + `maxAmount` put the modal into piggy-withdraw mode: kind,
 * wallet, category, subcategory and recurrence all stay fixed to what the
 * caller prefilled in `initial`, and the amount cannot exceed the piggy's
 * balance. Used by the Piggies view's "Withdraw" action so a withdrawal can
 * only ever land back in the envelope it came from.
 *
 * On savings deposits (`kind === "expense"` + savings category), an optional
 * Capital picker adds the amount to a plan's pot; default is Piggies.
 */
/** Draft payload for creating (`id` absent) or updating (`id` set) an expense. */
type ExpenseDraft = Omit<Expense, "id"> & { id?: string };

function AddExpenseModal({
  initial,
  wallets,
  defaultWalletId,
  categoryIndex,
  capitalPlans = [],
  onSave,
  onClose,
  onDelete,
  title,
  lockedSub,
  maxAmount,
}: {
  initial?: Partial<Expense> | null;
  wallets: FinancialWallet[];
  defaultWalletId: string;
  categoryIndex: CategoryIndex;
  capitalPlans?: CapitalPlan[];
  onSave: (payload: ExpenseDraft) => void | Promise<void>;
  onClose: () => void;
  onDelete: (id: string, opts?: DeleteExpenseOpts) => void | Promise<void>;
  title?: string;
  lockedSub?: string;
  maxAmount?: number;
}) {
  const editing = !!(initial && initial.id);
  const initialId = initial?.id;
  const initialDate = initial?.date;
  const locked = !!lockedSub;
  const initKind = initial?.kind ?? "expense";
  const { expenseCategories, incomeCategories, subById, catById } = categoryIndex;
  const firstSub = (id: string) => pickerSubs(catById[id])[0]?.id ?? id;
  const defaultExpenseCat = expenseCategories[0]?.id ?? "";
  const initSub = initial?.sub ? subById[initial.sub] : undefined;
  const initCat = initSub ? initSub.catId : defaultExpenseCat;
  const [kind, setKind] = useState(initKind);
  const [walletId, setWalletId] = useState(initial?.walletId ?? defaultWalletId);
  const [catId, setCatId] = useState(
    initKind === "income" ? (incomeCategories[0]?.id ?? "income") : initCat,
  );
  const [sub, setSub] = useState(
    initial?.sub
      ? initial.sub
      : firstSub(initKind === "income" ? (incomeCategories[0]?.id ?? "income") : defaultExpenseCat),
  );
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : "");
  const amountEvaluated = useMemo(() => evaluateExpression(amount), [amount]);
  const amountIsExpression = amountEvaluated !== null && !isPlainNumber(amount);
  const [date, setDate] = useState(initial?.date ? initial.date : TODAY_ISO);
  const [note, setNote] = useState(initial?.note ? initial.note : "");
  const initRecurring = normalizeRecurring(initial?.recurring);
  const [recurringOn, setRecurringOn] = useState(initRecurring !== false);
  const [recurringFreq, setRecurringFreq] = useState<RecurringInterval>(
    initRecurring !== false ? initRecurring : "monthly",
  );
  const [scopeOpen, setScopeOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [capitalPlanId, setCapitalPlanId] = useState(initial?.capitalPlanId ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = saving || deleting;
  const selectedWallet = wallets.find((w) => w.id === walletId) ?? wallets[0];
  const cur = getCurrency(selectedWallet?.currency);
  const visibleCategories = kind === "income" ? incomeCategories : expenseCategories;
  const showCapitalPicker =
    !locked && kind === "expense" && isSavingsCategory(catById[catId]) && capitalPlans.length > 0;
  const amtRef = useRef<HTMLInputElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });

  useEffect(() => {
    if (amtRef.current) amtRef.current.focus();
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !scopeOpen && !confirmOpen && !busy) requestClose(onClose);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [scopeOpen, confirmOpen, busy, onClose, requestClose]);

  const switchKind = (next: "expense" | "income") => {
    setKind(next);
    setCapitalPlanId("");
    if (next === "income") {
      const first = incomeCategories[0];
      setCatId(first?.id ?? "income");
      setSub(firstSub(first?.id ?? "income"));
    } else {
      const first = expenseCategories[0];
      setCatId(first?.id ?? "");
      setSub(firstSub(first?.id ?? ""));
    }
  };

  const chooseCat = (id: string) => {
    setCatId(id);
    setSub(firstSub(id));
    if (!isSavingsCategory(catById[id])) setCapitalPlanId("");
  };
  const overMax = maxAmount != null && amountEvaluated != null && amountEvaluated > maxAmount;
  const valid = amountEvaluated != null && amountEvaluated > 0 && date && !overMax;
  const submit = async () => {
    if (!valid || !walletId || busy) return;
    const payload: ExpenseDraft = {
      id: initial?.id,
      walletId,
      kind,
      date,
      sub,
      amount: Math.round(amountEvaluated * 100) / 100,
      note: note.trim() || subById[sub]?.name || "Transaction",
      recurring: recurringOn ? recurringFreq : false,
      ...(initial?.eventId ? { eventId: initial.eventId } : {}),
    };
    if (showCapitalPicker) {
      if (capitalPlanId) payload.capitalPlanId = capitalPlanId;
      else if (editing) payload.capitalPlanId = "";
    }
    setSaving(true);
    try {
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  /** Start delete — ask for scope when recurring, otherwise confirm once. */
  const requestDelete = () => {
    if (!initial?.id || busy) return;
    if (isRecurring({ recurring: initial.recurring ?? false })) {
      setScopeOpen(true);
      return;
    }
    setConfirmOpen(true);
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
          <h3>{title ?? (editing ? "Edit Transaction" : "Add Transaction")}</h3>
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
          {!locked ? (
            <>
              <label className="fld-label">Type</label>
              <Segmented
                options={[
                  { v: "expense", label: "Expense" },
                  { v: "income", label: "Income" },
                ]}
                value={kind}
                onChange={switchKind}
              />
            </>
          ) : null}

          {!locked && wallets.length > 1 ? (
            <div className="txn-wallet-field">
              <label className="fld-label">Wallet</label>
              <WalletPicker
                wallets={wallets}
                value={walletId}
                onChange={setWalletId}
                className="wallet-switch--block"
              />
            </div>
          ) : null}

          {amountIsExpression ? (
            <FadeIn className="amount-live-total">
              = {fmtMoney(amountEvaluated, { currency: selectedWallet?.currency })}
            </FadeIn>
          ) : null}
          {overMax ? (
            <FadeIn className="amount-live-total is-down">
              Max {fmtMoney(maxAmount, { currency: selectedWallet?.currency })} available
            </FadeIn>
          ) : null}
          <div className={"amount-field" + (kind === "income" ? " amount-field--income" : "")}>
            <span className="amount-cur">
              {kind === "income" ? "+" : ""}
              {cur.symbol}
            </span>
            <input
              ref={amtRef}
              type="text"
              inputMode="text"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              onBlur={() => {
                if (amountIsExpression) setAmount(String(amountEvaluated));
              }}
            />
          </div>

          {!locked ? (
            <>
              <div className="event-div" />
              <label className="fld-label">{kind === "income" ? "Source" : "Category"}</label>
              <div className="cat-grid">
                {visibleCategories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={"cat-chip" + (catId === c.id ? " active" : "")}
                    style={
                      catId === c.id
                        ? { borderColor: c.color, background: c.color + "16" }
                        : undefined
                    }
                    onClick={() => chooseCat(c.id)}
                  >
                    <span className="cc-glyph" style={{ color: c.color }}>
                      {displayGlyph(c.glyph, c.id)}
                    </span>
                    <span className="cc-label">{c.name}</span>
                  </button>
                ))}
              </div>

              <div className="event-div" />
              <label className="fld-label">Subcategory</label>
              <div className="sub-row">
                {pickerSubs(catById[catId], sub).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={"sub-chip" + (sub === s.id ? " active" : "")}
                    onClick={() => setSub(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <div className="event-div" />
            </>
          ) : null}

          {showCapitalPicker ? (
            <>
              <label className="fld-label">Allocate to</label>
              <div className="sub-row">
                <button
                  type="button"
                  className={"sub-chip" + (!capitalPlanId ? " active" : "")}
                  onClick={() => setCapitalPlanId("")}
                >
                  Piggies
                </button>
                {capitalPlans.map((plan: CapitalPlan) => (
                  <button
                    key={plan.id}
                    type="button"
                    className={"sub-chip" + (capitalPlanId === plan.id ? " active" : "")}
                    onClick={() => setCapitalPlanId(plan.id)}
                  >
                    {plan.glyph} {plan.name}
                  </button>
                ))}
              </div>
              <div className="event-div" />
            </>
          ) : null}

          <div className="fld-2col">
            <div>
              <label className="fld-label">Date</label>
              <DatePicker value={date} onChange={setDate} />
            </div>
            <div>
              <label className="fld-label">Note</label>
              <input
                className="text-in"
                type="text"
                placeholder="Optional"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          {!locked ? (
            <>
              <label className="toggle-line tight">
                <input
                  type="checkbox"
                  checked={recurringOn}
                  onChange={(e) => setRecurringOn(e.target.checked)}
                />
                <span className="toggle-ui" /> <span>Recurring</span>
              </label>
              {recurringOn ? (
                <div className="wallet-seg">
                  <Segmented
                    options={[
                      { v: "monthly", label: "Monthly" },
                      { v: "quarterly", label: "Quarterly" },
                      { v: "yearly", label: "Yearly" },
                    ]}
                    value={recurringFreq}
                    onChange={setRecurringFreq}
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="modal-foot">
          {editing ? (
            <button
              className="ghost-btn danger"
              type="button"
              onClick={requestDelete}
              disabled={busy}
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
              disabled={!valid || busy}
              onClick={submit}
            >
              {saving
                ? "Saving…"
                : locked
                  ? "Withdraw"
                  : editing
                    ? "Save Changes"
                    : kind === "income"
                      ? "Add Income"
                      : "Add Expense"}
            </button>
          </div>
        </div>
      </div>
      {scopeOpen && initialId ? (
        <DeleteScopeDialog
          title="Delete Recurring Transaction"
          onCancel={() => setScopeOpen(false)}
          onConfirm={async (scope) => {
            await onDelete(initialId, { scope, fromDate: initialDate });
            setScopeOpen(false);
          }}
        />
      ) : null}
      {confirmOpen && initialId ? (
        <ConfirmDialog
          title="Delete Transaction"
          message="Delete this transaction? This cannot be undone."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await onDelete(initialId);
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

export {
  AddExpenseModal,
  CatGlyph,
  ConfirmDialog,
  DeleteScopeDialog,
  EmptyState,
  Icon,
  InsightFeed,
  MobileBottomNav,
  MonthSwitcher,
  Segmented,
  Sidebar,
  SummaryCard,
  TransactionRow,
  WalletPicker,
  glyphTint,
};
