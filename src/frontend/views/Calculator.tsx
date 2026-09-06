import { useEnter, useModalMotion, useStagger } from "@/frontend/lib/animate";
import { CatGlyph, EmptyState, Icon, SummaryCard } from "@/frontend/components/ui";
import {
  allocateBudgets,
  budgetsFromAmounts,
  computeNet,
  isValidAllocationAmounts,
  isValidAllocationTotal,
  isValidTaxTotal,
  MY_TAX_PRESETS,
  percentsFromAmounts,
  sumPercents,
  type TaxPreset,
} from "@/frontend/lib/calculator";
import { fmtMoney, getCurrency, roundMoney } from "@/frontend/lib/data";
import {
  preventNegativeKeys,
  preventWheelChange,
  stripNegativeInput,
} from "@/frontend/lib/number-input";
import type { Budgets, CategoryIndex, FinancialWallet } from "@/frontend/lib/types";
import { useEffect, useId, useMemo, useRef, useState } from "react";

/*
 * Calculator — budgeting helper
 * ─────────────────────────────
 * Client-side only: deduct custom tax lines from income, allocate the
 * net across expense categories by percent or amount, then optionally
 * apply the result to wallet budgets via a confirmation modal.
 * Layout: Income + Tax Collection share a setup grid on wider screens;
 * Allocate by Category uses a live progress bar, a Percent/Amount
 * toggle, and responsive cards.
 * Typography: Young Serif / Schibsted Grotesk / Azeret Mono via fonts.css.
 */

type AllocMode = "percent" | "amount";

type TaxLine = {
  id: string;
  title: string;
  pct: string;
  /** When set, this row was added by a tax preset toggle. */
  presetId?: string;
};

type CalculatorProps = {
  wallet: FinancialWallet | null | undefined;
  budgets: Budgets;
  setBudgets: (next: Budgets) => void;
  budgetsSaving?: boolean;
  currency: string;
  categoryIndex: CategoryIndex;
};

/** Parse a non-negative number from a draft string; empty → 0. */
function parseNonNeg(raw: string): number {
  const n = parseFloat(raw);

  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Create a unique local id for ephemeral tax rows. */
function newTaxId(): string {
  return `tax-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Build an empty tax line with a default title. */
function emptyTaxLine(index: number): TaxLine {
  return { id: newTaxId(), title: index === 0 ? "Tax" : `Tax ${index + 1}`, pct: "" };
}

export function Calculator({
  wallet,
  budgets,
  setBudgets,
  budgetsSaving = false,
  currency,
  categoryIndex,
}: CalculatorProps) {
  const expenseCategories = categoryIndex.expenseCategories;
  const [grossDraft, setGrossDraft] = useState("");
  const [taxLines, setTaxLines] = useState<TaxLine[]>(() => [emptyTaxLine(0)]);
  const [pctByCat, setPctByCat] = useState<Record<string, string>>({});
  const [amtByCat, setAmtByCat] = useState<Record<string, string>>({});
  const [allocMode, setAllocMode] = useState<AllocMode>("percent");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applied, setApplied] = useState(false);
  const titleId = useId();
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    active: confirmOpen,
  });
  const closeConfirm = () => requestClose(() => setConfirmOpen(false));

  /** Prefill income from the active wallet when the wallet changes. */
  useEffect(() => {
    const income = wallet?.income ?? 0;
    setGrossDraft(income > 0 ? String(income) : "");
    setApplied(false);
  }, [wallet?.id, wallet?.income]);

  /** Keep allocation draft keys aligned with expense categories. */
  useEffect(() => {
    const ids = expenseCategories.map((c) => c.id);

    setPctByCat((prev) => alignDraftMap(prev, ids));
    setAmtByCat((prev) => alignDraftMap(prev, ids));
  }, [expenseCategories]);

  const gross = parseNonNeg(grossDraft);
  const taxPercents = taxLines.map((t) => parseNonNeg(t.pct));
  const taxSum = sumPercents(taxPercents);
  const taxOk = isValidTaxTotal(taxPercents);
  const net = taxOk ? computeNet(gross, taxPercents) : 0;
  const taxAmount = taxOk ? Math.max(0, gross - net) : 0;

  const allocations = useMemo(
    () =>
      expenseCategories.map((c) => ({
        id: c.id,
        pct: parseNonNeg(pctByCat[c.id] ?? ""),
      })),
    [expenseCategories, pctByCat],
  );

  const amountRows = useMemo(
    () =>
      expenseCategories.map((c) => ({
        id: c.id,
        amount: parseNonNeg(amtByCat[c.id] ?? ""),
      })),
    [expenseCategories, amtByCat],
  );

  const allocSum = sumPercents(allocations.map((a) => a.pct));
  const allocAmtSum = amountRows.reduce((sum, row) => sum + row.amount, 0);
  const allocOk =
    expenseCategories.length > 0 &&
    (allocMode === "percent"
      ? isValidAllocationTotal(allocations.map((a) => a.pct))
      : net > 0 &&
        isValidAllocationAmounts(
          amountRows.map((a) => a.amount),
          net,
        ));
  const canApply = gross > 0 && taxOk && allocOk;

  const computed = useMemo(() => {
    if (!canApply) return {};

    return allocMode === "percent"
      ? allocateBudgets(net, allocations)
      : budgetsFromAmounts(net, amountRows);
  }, [canApply, net, allocations, amountRows, allocMode]);

  /** Which presets currently have rows in the tax list. */
  const activeTaxPresetIds = useMemo(() => {
    const ids = new Set<string>();

    for (const row of taxLines) {
      if (row.presetId) ids.add(row.presetId);
    }

    return ids;
  }, [taxLines]);

  /** Update a tax line field by id; detaches the row from any preset. */
  const patchTax = (id: string, patch: Partial<TaxLine>) => {
    setTaxLines((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch, presetId: undefined } : r)),
    );
  };

  /** Append a new empty tax line (custom; does not clear preset toggles). */
  const addTax = () => {
    setTaxLines((rows) => [...rows, emptyTaxLine(rows.length)]);
  };

  /** Remove a tax line (keep at least one blank row when the list would empty). */
  const removeTax = (id: string) => {
    setTaxLines((rows) => {
      const next = rows.filter((r) => r.id !== id);

      return next.length ? next : [emptyTaxLine(0)];
    });
  };

  /**
   * Toggle a tax preset on (append its lines) or off (remove its lines).
   * Multiple presets can be active at once.
   */
  const toggleTaxPreset = (preset: TaxPreset) => {
    markDirty();

    if (activeTaxPresetIds.has(preset.id)) {
      setTaxLines((rows) => {
        const next = rows.filter((r) => r.presetId !== preset.id);

        return next.length ? next : [emptyTaxLine(0)];
      });

      return;
    }

    setTaxLines((rows) => {
      const withoutPlaceholder =
        rows.length === 1 && !rows[0]?.presetId && !rows[0]?.title.trim() && !rows[0]?.pct.trim()
          ? []
          : rows;

      const added = preset.lines.map((line) => ({
        id: newTaxId(),
        title: line.title,
        pct: String(line.pct),
        presetId: preset.id,
      }));

      return [...withoutPlaceholder, ...added];
    });
  };

  /** Persist computed budgets after modal confirm. */
  const applyBudgets = () => {
    if (!canApply || budgetsSaving) return;

    setBudgets({ ...budgets, ...computed });
    setConfirmOpen(false);
    setApplied(true);
  };

  /** Clear the success state when the user edits the calculator. */
  const markDirty = () => {
    if (applied) setApplied(false);
  };

  /** Switch percent/amount input, converting drafts when net is positive. */
  const switchAllocMode = (next: AllocMode) => {
    if (next === allocMode) return;

    markDirty();

    if (net > 0) {
      const ids = expenseCategories.map((c) => c.id);

      if (next === "amount") {
        setAmtByCat(draftsFromValues(ids, allocateBudgets(net, allocations)));
      } else {
        setPctByCat(draftsFromValues(ids, percentsFromAmounts(net, amountRows)));
      }
    }

    setAllocMode(next);
  };

  const remainingAlloc = 100 - allocSum;
  const remainingAmt = net - allocAmtSum;
  const fillPct = allocMode === "percent" ? allocSum : net > 0 ? (allocAmtSum / net) * 100 : 0;
  const remainingOver = allocMode === "percent" ? remainingAlloc < 0 : remainingAmt < 0;
  const cur = getCurrency(currency);
  const viewRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useEnter(viewRef);
  useStagger(gridRef, ".summary-card");

  return (
    <div ref={viewRef} className="view">
      <div ref={gridRef} className="summary-grid sg-3" data-tour="tour-calculator-summary">
        <SummaryCard
          label="Gross Income"
          value={fmtMoney(gross, { currency })}
          sub="calculator draft"
        />
        <SummaryCard
          label="Tax Total"
          tone="spent"
          value={fmtMoney(taxAmount, { currency })}
          sub={taxOk ? `${formatPct(taxSum)} of gross` : "tax exceeds 100%"}
        />
        <SummaryCard
          label="Net After Tax"
          tone={taxOk ? "ok" : "danger"}
          value={fmtMoney(net, { currency })}
          sub="available to allocate"
        />
      </div>

      <div className="calculator-setup-grid">
        <section className="panel" data-tour="tour-calculator-income">
          <div className="panel-head">
            <h2>Income</h2>
            <p className="panel-sub">Prefills from wallet income — edits stay on this screen</p>
          </div>
          <label className="fld-label">Gross amount</label>
          <div className="amount-field">
            <span className="amount-cur">{cur.symbol}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={grossDraft}
              onChange={(e) => {
                markDirty();
                setGrossDraft(stripNegativeInput(e.target.value));
              }}
              onKeyDown={preventNegativeKeys}
              onWheel={preventWheelChange}
            />
          </div>
        </section>

        <section className="panel" data-tour="tour-calculator-tax">
          <div className="panel-head">
            <h2>Tax Collection</h2>
            <p className="panel-sub">
              Custom titles and percentages — not saved. Toggle MY presets on to add lines, off to
              remove them (multiple allowed; estimates only).
            </p>
          </div>
          <div className="calculator-presets" role="group" aria-label="Tax presets">
            {MY_TAX_PRESETS.map((preset) => {
              const pressed = activeTaxPresetIds.has(preset.id);

              return (
                <button
                  key={preset.id}
                  type="button"
                  className={"mini-btn calculator-preset-toggle" + (pressed ? " is-active" : "")}
                  title={preset.description}
                  aria-pressed={pressed}
                  onClick={() => toggleTaxPreset(preset)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="calculator-tax-list">
            {taxLines.map((line) => (
              <div key={line.id} className="calculator-tax-row">
                <div className="calculator-tax-title">
                  <label className="fld-label">Title</label>
                  <input
                    className="text-in"
                    type="text"
                    value={line.title}
                    placeholder="Tax name"
                    onChange={(e) => {
                      markDirty();
                      patchTax(line.id, { title: e.target.value });
                    }}
                  />
                </div>
                <div className="calculator-tax-pct">
                  <label className="fld-label">Percent</label>
                  <div className="calculator-pct-field">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0"
                      value={line.pct}
                      onChange={(e) => {
                        markDirty();
                        patchTax(line.id, { pct: stripNegativeInput(e.target.value) });
                      }}
                      onKeyDown={preventNegativeKeys}
                      onWheel={preventWheelChange}
                    />
                    <span className="calculator-pct-suffix">%</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn calculator-tax-remove"
                  aria-label="Remove Tax Line"
                  disabled={taxLines.length <= 1}
                  onClick={() => {
                    markDirty();
                    removeTax(line.id);
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
          {!taxOk ? (
            <p className="calculator-warn" role="status">
              Tax percentages cannot exceed 100%.
            </p>
          ) : null}
          <div className="calculator-row-actions">
            <button
              type="button"
              className="ghost-btn sm"
              onClick={() => {
                markDirty();
                addTax();
              }}
            >
              Add Tax Line
            </button>
            <span className="calculator-meta">Total tax {formatPct(taxSum)}</span>
          </div>
        </section>
      </div>

      <section className="panel" data-tour="tour-calculator-allocate">
        <div className="panel-head calculator-alloc-head">
          <div className="calculator-alloc-head-copy">
            <h2>Allocate by Category</h2>
            <p className="panel-sub">
              {allocMode === "percent"
                ? "Percentages must total 100%"
                : "Amounts must total net after tax"}
            </p>
          </div>
          <div className="calculator-alloc-mode" role="radiogroup" aria-label="Allocation input">
            <button
              type="button"
              role="radio"
              aria-checked={allocMode === "percent"}
              className={
                "mini-btn calculator-preset-toggle" + (allocMode === "percent" ? " is-active" : "")
              }
              onClick={() => switchAllocMode("percent")}
            >
              Percent
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={allocMode === "amount"}
              className={
                "mini-btn calculator-preset-toggle" + (allocMode === "amount" ? " is-active" : "")
              }
              onClick={() => switchAllocMode("amount")}
            >
              Amount
            </button>
          </div>
        </div>

        {!expenseCategories.length ? (
          <EmptyState
            title="No Expense Categories"
            sub="Add categories first, then return here to allocate."
          />
        ) : (
          <>
            <div
              className={
                "calculator-alloc-progress" +
                (allocOk
                  ? " calculator-alloc-progress--ok"
                  : remainingOver
                    ? " calculator-alloc-progress--over"
                    : " calculator-alloc-progress--under")
              }
              role="status"
              aria-label={
                allocMode === "percent"
                  ? `Allocated ${formatPct(allocSum)}`
                  : `Allocated ${fmtMoney(allocAmtSum, { currency })} of ${fmtMoney(net, { currency })}`
              }
            >
              <div className="calculator-alloc-progress-head">
                <span>Allocation</span>
                <span className="num">
                  {allocMode === "percent" ? (
                    <>
                      {formatPct(allocSum)}
                      {allocOk
                        ? " — ready"
                        : ` — ${formatPct(Math.abs(remainingAlloc))} ${remainingAlloc > 0 ? "left" : "over"}`}
                    </>
                  ) : (
                    <>
                      {fmtMoney(allocAmtSum, { currency })}
                      {allocOk
                        ? " — ready"
                        : ` — ${fmtMoney(Math.abs(remainingAmt), { currency })} ${remainingAmt > 0 ? "left" : "over"}`}
                    </>
                  )}
                </span>
              </div>
              <div className="calculator-alloc-track" aria-hidden="true">
                <div
                  className="calculator-alloc-fill"
                  style={{ width: `${Math.min(Math.max(fillPct, 0), 100)}%` }}
                />
              </div>
            </div>

            <div className="calculator-alloc-list">
              {expenseCategories.map((c) => {
                const pct = parseNonNeg(pctByCat[c.id] ?? "");
                const amountDraft = parseNonNeg(amtByCat[c.id] ?? "");
                const derivedAmount = canApply
                  ? (computed[c.id] ?? 0)
                  : roundMoney((net * pct) / 100);
                const derivedPct =
                  net > 0
                    ? canApply
                      ? ((computed[c.id] ?? 0) / net) * 100
                      : (amountDraft / net) * 100
                    : 0;

                return (
                  <div key={c.id} className="calculator-alloc-row">
                    <div className="calculator-alloc-name">
                      <CatGlyph glyph={c.glyph} id={c.id} />
                      <span>{c.name}</span>
                    </div>
                    <div className="calculator-alloc-controls">
                      {allocMode === "percent" ? (
                        <>
                          <div className="calculator-alloc-amt num">
                            {fmtMoney(derivedAmount, { currency })}
                          </div>
                          <div className="calculator-pct-field">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              placeholder="0"
                              value={pctByCat[c.id] ?? ""}
                              onChange={(e) => {
                                markDirty();
                                setPctByCat((prev) => ({
                                  ...prev,
                                  [c.id]: stripNegativeInput(e.target.value),
                                }));
                              }}
                              onKeyDown={preventNegativeKeys}
                              onWheel={preventWheelChange}
                              aria-label={`${c.name} percent`}
                            />
                            <span className="calculator-pct-suffix">%</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="calculator-alloc-amt num">{formatPct(derivedPct)}</div>
                          <div className="calculator-pct-field calculator-amt-field">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={amtByCat[c.id] ?? ""}
                              onChange={(e) => {
                                markDirty();
                                setAmtByCat((prev) => ({
                                  ...prev,
                                  [c.id]: stripNegativeInput(e.target.value),
                                }));
                              }}
                              onKeyDown={preventNegativeKeys}
                              onWheel={preventWheelChange}
                              aria-label={`${c.name} amount`}
                            />
                            <span className="calculator-pct-suffix">{cur.symbol}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <div className="calculator-apply" data-tour="tour-calculator-apply">
        <button
          type="button"
          className={"primary-btn" + (applied ? " calculator-apply-success" : "")}
          disabled={!canApply || applied}
          onClick={() => setConfirmOpen(true)}
        >
          {applied ? "Apply Successful" : "Apply to Budgets"}
        </button>
        <p className="calculator-apply-hint">
          Replaces every expense category budget on the active wallet.
        </p>
      </div>

      {confirmOpen ? (
        <div
          ref={scrimRef}
          className="modal-scrim center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !budgetsSaving) closeConfirm();
          }}
        >
          <div
            ref={panelRef}
            className="modal sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <div className="modal-head">
              <h3 id={titleId}>Apply Calculator Budgets?</h3>
              <button
                className="icon-btn"
                type="button"
                onClick={closeConfirm}
                disabled={budgetsSaving}
                aria-label="Close"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="modal-body modal-scroll">
              <p className="calculator-confirm-lead">
                This updates all expense category budgets on{" "}
                <strong>{wallet?.name ?? "this wallet"}</strong> to the amounts below.
              </p>
              <ul className="calculator-confirm-list">
                {expenseCategories.map((c) => (
                  <li key={c.id}>
                    <span className="calculator-confirm-name">
                      <CatGlyph glyph={c.glyph} id={c.id} /> {c.name}
                    </span>
                    <span className="num">{fmtMoney(computed[c.id] ?? 0, { currency })}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="modal-foot">
              <span />
              <div className="mf-right">
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={budgetsSaving}
                  onClick={closeConfirm}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={budgetsSaving}
                  onClick={applyBudgets}
                >
                  {budgetsSaving ? "Applying…" : "Confirm Apply"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Format a percentage for status text (trim trailing zeros). */
function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "0%";

  const rounded = Math.round(n * 100) / 100;

  return `${rounded}%`;
}

/** Keep a draft map keyed to the given category ids. */
function alignDraftMap(prev: Record<string, string>, ids: string[]): Record<string, string> {
  const next: Record<string, string> = {};

  for (const id of ids) {
    next[id] = prev[id] ?? "";
  }

  return next;
}

/** Stringify a positive number for an allocation draft; zero → empty. */
function draftFromNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";

  return String(n);
}

/** Build category draft strings from a computed number map. */
function draftsFromValues(ids: string[], values: Record<string, number>): Record<string, string> {
  const next: Record<string, string> = {};

  for (const id of ids) {
    next[id] = draftFromNumber(values[id] ?? 0);
  }

  return next;
}
