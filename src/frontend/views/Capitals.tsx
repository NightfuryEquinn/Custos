import { ReadableValue } from "@/frontend/components/ReadableValue";
import { DatePicker } from "@/frontend/components/DateTimePicker";
import { ConfirmDialog, EmptyState, Icon } from "@/frontend/components/ui";
import { isPlainNumber } from "@/frontend/lib/arithmetic";
import { openConfirm, toast } from "@/frontend/lib/feedback";
import {
  newCapitalItem,
  planBudgetProgress,
  planIsOverbudget,
  planMoney,
  planMonthlyPlan,
  planSavedTotal,
} from "@/frontend/lib/capitals";
import { CAPITAL_TEMPLATES, type CapitalTemplate } from "@/frontend/lib/capitalTemplates";
import { fmtMoney } from "@/frontend/lib/data";
import { useEnter, useModalMotion } from "@/frontend/lib/animate";
import type {
  CapitalItem,
  CapitalPlan,
  CapitalTemplateId,
  CategoryIndex,
  Expense,
} from "@/frontend/lib/types";
import { TODO_ICON_OPTIONS } from "@/lib/glyphs";
import { Fragment, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";

/*
 * Capitals — future financial planner
 * ────────────────────────────────────
 * Standalone checklists for big life expenses (marriage, trips, loans, or
 * fully custom plans). Each plan carries a total budget (or falls back to the
 * sum of its item estimates) and an optional target date; monthly save is what
 * was still to set aside at the start of the month — the unpaid budget less the
 * plan's pot — divided by the months left, with a "left this month" sub-line
 * that shrinks as deposits land. Savings deposits can optionally be assigned to a
 * plan (otherwise Piggies), and paying an item draws that pot down.
 * Overbudget plans show Overpaid. Line items can optionally be "logged" into
 * the real ledger when paid.
 */

type CapitalsProps = {
  capitalPlans: CapitalPlan[];
  savingsTxns: Expense[];
  categoryIndex: CategoryIndex;
  currency: string;
  onSavePlan: (data: Partial<CapitalPlan> & { id?: string }) => Promise<CapitalPlan>;
  onDeletePlan: (id: string) => Promise<unknown>;
  onLogItem: (plan: CapitalPlan, item: CapitalItem) => void;
};

/** Imperative handle so the shell's quick-add FAB can trigger New Plan. */
export type CapitalsHandle = { openAdd: () => void };

type EditorMode = { type: "add-plan" } | { type: "edit-plan"; planId: string };

const ICONS = TODO_ICON_OPTIONS;

const AMOUNT_ERROR = "Enter an amount of 0 or more.";

/** A money field's text as a non-negative number, or null when blank or not a plain number. */
function parseAmount(text: string): number | null {
  const t = text.trim();
  if (!t || !isPlainNumber(t)) return null;
  const n = Number(t);

  return Number.isFinite(n) ? n : null;
}

/**
 * Add / edit modal for a plan. Draft state lives here so the unsaved-changes
 * baseline is taken when the modal opens; `onSave` persists and closes it, and
 * rejects with the reason a save failed.
 */
function PlanEditor({
  mode,
  plans,
  onSave,
  onClose,
}: {
  mode: EditorMode;
  plans: CapitalPlan[];
  onSave: (data: Partial<CapitalPlan> & { id?: string }, message: string) => Promise<void>;
  onClose: () => void;
}) {
  const plan = mode.type === "edit-plan" ? plans.find((p) => p.id === mode.planId) : undefined;
  const [templateId, setTemplateId] = useState<CapitalTemplateId>("custom");
  const [name, setName] = useState(plan?.name ?? "");
  const [glyph, setGlyph] = useState(plan?.glyph ?? "🎯");
  const [targetDate, setTargetDate] = useState(plan?.targetDate ?? "");
  const [initialBudget, setInitialBudget] = useState(
    plan?.initialBudget != null && plan.initialBudget > 0 ? String(plan.initialBudget) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  /* `saving` state alone can't stop two clicks in the same task from both
     saving — a ref flips synchronously, so the second call always sees it. */
  const savingRef = useRef(false);
  const fields = JSON.stringify([templateId, name, glyph, targetDate, initialBudget]);
  const [baseline] = useState(fields);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  const { dismiss } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    onDismiss: saving ? false : onClose,
    dirty: fields !== baseline,
  });

  const editing = mode.type === "edit-plan";
  /* The budget is optional: blank means none (0), but text must be a number. */
  const budget = initialBudget.trim() ? parseAmount(initialBudget) : 0;
  const valid = !!name.trim() && budget !== null;

  const pickTemplate = (t: CapitalTemplate | null) => {
    if (!t) {
      setTemplateId("custom");
      setGlyph("🎯");
      return;
    }
    setTemplateId(t.id);
    setGlyph(t.glyph);
    if (!name) setName(t.name);
  };

  const save = async () => {
    if (!valid || budget === null || saving || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (mode.type === "add-plan") {
        const items: CapitalItem[] = [];
        if (templateId !== "custom") {
          const template = CAPITAL_TEMPLATES.find((t) => t.id === templateId);
          for (const itemName of template?.items ?? []) items.push(newCapitalItem(itemName, items));
        }
        await onSave(
          {
            name: name.trim(),
            glyph,
            templateId,
            targetDate: targetDate || undefined,
            initialBudget: budget,
            createdAt: new Date().toISOString(),
            items,
          },
          "Plan added",
        );
      } else {
        await onSave(
          {
            id: mode.planId,
            name: name.trim(),
            glyph,
            targetDate: targetDate || undefined,
            initialBudget: budget,
          },
          "Plan updated",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this plan. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return createPortal(
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
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="modal-head">
          <h3>{editing ? "Edit Plan" : "New Plan"}</h3>
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
          <div className="dm-sec">
            {mode.type === "add-plan" ? (
              <>
                <label className="fld-label">Template</label>
                <div className="capital-template-row">
                  <button
                    type="button"
                    className={"fchip" + (templateId === "custom" ? " active" : "")}
                    onClick={() => pickTemplate(null)}
                  >
                    Custom
                  </button>
                  {CAPITAL_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={"fchip" + (templateId === t.id ? " active" : "")}
                      onClick={() => pickTemplate(t)}
                    >
                      {t.glyph} {t.name}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <label className="fld-label" htmlFor="capital-plan-name">
              Plan name
            </label>
            <input
              id="capital-plan-name"
              className="text-in wallet-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="e.g. Our Wedding, Bali Trip"
            />

            <label className="fld-label">Target date (optional)</label>
            <DatePicker value={targetDate} onChange={setTargetDate} className="wallet-field" />

            <label className="fld-label" htmlFor="capital-plan-budget">
              Total budget (optional)
            </label>
            <input
              id="capital-plan-budget"
              className="text-in wallet-field"
              type="text"
              inputMode="decimal"
              value={initialBudget}
              onChange={(e) => setInitialBudget(e.target.value)}
              placeholder="0"
              aria-invalid={budget === null || undefined}
            />
            {budget === null ? (
              <p className="fld-error">Enter a number of 0 or more, or leave it blank.</p>
            ) : null}

            <label className="fld-label">Icon</label>
            <div className="cat-glyph-row">
              {ICONS.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={"cat-glyph-btn" + (glyph === g ? " active" : "")}
                  onClick={() => setGlyph(g)}
                >
                  {g}
                </button>
              ))}
            </div>

            {error ? (
              <p className="auth-error auth-error--gap" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <div className="modal-foot">
          <span />
          <div className="mf-right">
            <button className="ghost-btn" type="button" onClick={dismiss} disabled={saving}>
              Cancel
            </button>
            <button className="primary-btn" type="submit" disabled={saving || !valid}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Add Plan"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** "14 Mar 2027" — a plan's target date can be years out, so include the year. */
function dueDateLabel(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export const Capitals = forwardRef<CapitalsHandle, CapitalsProps>(function Capitals(
  { capitalPlans, savingsTxns, categoryIndex, currency, onSavePlan, onDeletePlan, onLogItem },
  ref,
) {
  const [plans, setPlans] = useState(capitalPlans);
  const [editor, setEditor] = useState<EditorMode | null>(null);
  /* Disables plan delete buttons while any plan save is in flight; each action
     reports its own progress, so this carries no label. */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* `busy` state can't stop two clicks landing in the same task (a
     touch-synthesized click racing the real one) from both calling
     persistPlan before either's setBusy(true) commits — a ref flips
     synchronously, so the second call always sees it. */
  const persistingRef = useRef(false);
  const [itemDraftFor, setItemDraftFor] = useState<string | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemCost, setItemCost] = useState("");
  const [itemError, setItemError] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [editingCost, setEditingCost] = useState<string | null>(null);
  const [costDraft, setCostDraft] = useState("");
  const [costError, setCostError] = useState("");
  const [itemBusy, setItemBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<
    { type: "plan"; id: string } | { type: "item"; planId: string; itemId: string } | null
  >(null);

  useEffect(() => {
    setPlans(capitalPlans);
  }, [capitalPlans]);

  const money = (n: number) => fmtMoney(n, { currency });
  const viewRef = useRef<HTMLDivElement>(null);
  useEnter(viewRef);

  /**
   * Save a plan. Resolves with the saved plan (undefined when another save is
   * already running) and rejects on failure, so each caller shows the reason
   * where the user is looking.
   */
  const persistPlan = async (data: Partial<CapitalPlan> & { id?: string }) => {
    if (persistingRef.current) return undefined;
    persistingRef.current = true;
    setBusy(true);
    try {
      const saved = await onSavePlan(data);
      setPlans((prev) =>
        data.id ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved],
      );

      return saved;
    } finally {
      persistingRef.current = false;
      setBusy(false);
    }
  };

  const openAddPlan = () => {
    setEditor({ type: "add-plan" });
    setError("");
  };

  useImperativeHandle(ref, () => ({ openAdd: openAddPlan }));

  const openEditPlan = (plan: CapitalPlan) => {
    setEditor({ type: "edit-plan", planId: plan.id });
    setError("");
  };

  /** Save from the plan editor: close it and confirm with a toast. */
  const saveEditor = async (data: Partial<CapitalPlan> & { id?: string }, message: string) => {
    if (!(await persistPlan(data))) return;
    setEditor(null);
    toast(message);
  };

  /** Rejects on failure so the confirm dialog shows why. */
  const removePlan = async (planId: string) => {
    await onDeletePlan(planId);
    setPlans((prev) => prev.filter((p) => p.id !== planId));
    toast("Plan deleted");
  };

  /** Open the inline "add item" draft row for a plan. */
  const openAddItem = (planId: string) => {
    if (itemBusy) return;
    setItemDraftFor(planId);
    setItemName("");
    setItemCost("");
    setItemError("");
  };

  /** Commit the draft item to a plan and persist. The draft stays open on failure. */
  const submitAddItem = async (plan: CapitalPlan) => {
    if (itemBusy) return;
    if (!itemName.trim()) return;
    /* Blank means 0, but text must be a number. */
    const cost = itemCost.trim() ? parseAmount(itemCost) : 0;
    if (cost === null) {
      setItemError(AMOUNT_ERROR);
      return;
    }
    const item = newCapitalItem(itemName.trim(), plan.items);
    item.estimatedCost = cost;
    setItemError("");
    setItemBusy(true);
    setAddingItem(true);
    try {
      if (await persistPlan({ id: plan.id, items: [...plan.items, item] })) setItemDraftFor(null);
    } catch (err) {
      setItemError(
        err instanceof Error ? err.message : "Could not add this item. Please try again.",
      );
    } finally {
      setItemBusy(false);
      setAddingItem(false);
    }
  };

  /** Remove an item from a plan and persist. Rejects on failure so the confirm dialog shows why. */
  const removeItem = async (plan: CapitalPlan, itemId: string) => {
    if (itemBusy) throw new Error("Another change is still saving. Try again in a moment.");
    setItemBusy(true);
    try {
      const saved = await persistPlan({
        id: plan.id,
        items: plan.items.filter((i) => i.id !== itemId),
      });
      if (saved) toast("Item deleted");
    } finally {
      setItemBusy(false);
    }
  };

  /**
   * Flip an item's paid state and persist. Un-ticking also drops `actualCost`
   * and the logged-expense link, which described a payment that is no longer
   * being claimed — left behind, they would keep the item tied to a ledger row
   * it no longer represents.
   */
  const applyPaidToggle = async (plan: CapitalPlan, item: CapitalItem) => {
    if (itemBusy) throw new Error("Another change is still saving. Try again in a moment.");
    setItemBusy(true);
    try {
      const items = plan.items.map((i) => {
        if (i.id !== item.id) return i;
        if (!i.paid) return { ...i, paid: true };
        const { actualCost: _cost, loggedExpenseId: _link, ...rest } = i;

        return { ...rest, paid: false };
      });
      await persistPlan({ id: plan.id, items });
    } finally {
      setItemBusy(false);
    }
  };

  /** Mark paid right away; un-marking an item with a logged cost or payment asks first. */
  const togglePaid = async (plan: CapitalPlan, item: CapitalItem) => {
    if (itemBusy) return;
    if (item.paid && (item.actualCost !== undefined || item.loggedExpenseId)) {
      openConfirm({
        title: "Mark Unpaid",
        message:
          "This clears the logged cost and unlinks its payment record. The payment itself is not deleted.",
        confirmLabel: "Mark Unpaid",
        pendingLabel: "Updating…",
        danger: true,
        onConfirm: () => applyPaidToggle(plan, item),
      });
      return;
    }
    setError("");
    try {
      await applyPaidToggle(plan, item);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update this item. Please try again.",
      );
    }
  };

  /** Open the inline cost editor for an item. */
  const startEditCost = (item: CapitalItem) => {
    setEditingCost(item.id);
    setCostDraft(String(item.estimatedCost));
    setCostError("");
  };

  /** Leave the inline cost editor without saving. */
  const cancelEditCost = () => {
    setEditingCost(null);
    setCostError("");
  };

  /** Commit the edited cost for an item and persist. Invalid text keeps the editor open. */
  const commitCost = async (plan: CapitalPlan, item: CapitalItem) => {
    if (itemBusy || editingCost !== item.id) return;

    const value = parseAmount(costDraft);
    if (value === null) {
      setCostError(AMOUNT_ERROR);
      return;
    }
    cancelEditCost();
    if (value === item.estimatedCost) return;

    const items = plan.items.map((i) => (i.id === item.id ? { ...i, estimatedCost: value } : i));
    setError("");
    setItemBusy(true);
    try {
      await persistPlan({ id: plan.id, items });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this cost. Please try again.");
    } finally {
      setItemBusy(false);
    }
  };

  if (!plans.length && !editor) {
    return (
      <div ref={viewRef} className="view">
        <EmptyState
          title="No Plans Yet"
          sub="Start a plan for a big future expense — set a budget and target date to see how much to save each month."
        />
      </div>
    );
  }

  return (
    <div ref={viewRef} className="view">
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="capital-grid" data-tour="tour-capitals-grid">
        {plans.map((plan) => {
          const m = planMoney(plan, savingsTxns, categoryIndex);
          const progress = planBudgetProgress(plan);
          const overbudget = planIsOverbudget(plan);
          const monthly = planMonthlyPlan(plan, new Date(), savingsTxns, categoryIndex);
          /* Three segments so the grey one is what is genuinely left to fund, not
             budget − paid: money already in the pot covers part of that. */
          const segments =
            m.budget > 0
              ? [
                  {
                    id: "paid",
                    label: "Paid",
                    value: Math.min(m.paid, m.budget),
                    color: overbudget ? "var(--danger)" : "var(--saved)",
                  },
                  {
                    id: "unspent",
                    label: "Unspent",
                    value: Math.min(m.unspent, m.outstanding),
                    color: "var(--ok)",
                  },
                  {
                    id: "remain",
                    label: "Remaining",
                    value: m.remainingNeed,
                    color: "var(--hair)",
                  },
                ]
              : [];
          const segTotal = segments.reduce((s, x) => s + x.value, 0);
          const tag = [
            plan.targetDate ? `Due ${dueDateLabel(plan.targetDate)}` : null,
            progress !== null ? `${Math.round(progress * 100)}% paid` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const saveValue = overbudget
            ? "Overpaid"
            : monthly && m.remainingNeed > 0
              ? money(monthly.perMonth)
              : "—";
          const saveSub = overbudget
            ? `${money(m.paid - m.budget)} over budget`
            : monthly
              ? m.remainingNeed === 0
                ? "Fully funded"
                : monthly.leftThisMonth > 0
                  ? `${money(monthly.leftThisMonth)} left this month`
                  : "Covered this month"
              : m.budget <= 0
                ? "Add a budget"
                : plan.targetDate
                  ? "Target date passed"
                  : "Set a target date";

          return (
            <div key={plan.id} className="capital-card">
              <div className="capital-card-head">
                <span className="capital-card-glyph">{plan.glyph}</span>
                <div className="capital-card-title">
                  <h3>{plan.name}</h3>
                  {tag ? <span className="capital-tag">{tag}</span> : null}
                </div>
                <div className="capital-card-actions">
                  <button type="button" onClick={() => openEditPlan(plan)} aria-label="Edit Plan">
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => setConfirmDelete({ type: "plan", id: plan.id })}
                    aria-label="Delete Plan"
                    title="Delete Plan"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>

              <div className="cap-stats">
                {[
                  { label: "Total", value: m.budget },
                  { label: "Saved", value: m.saved },
                  { label: "Paid", value: m.paid },
                  { label: "Unspent", value: m.unspent },
                ].map((s) => (
                  <div key={s.label} className="cap-stat">
                    <span className="cap-stat-label">{s.label}</span>
                    <ReadableValue as="span" className="cap-stat-value">
                      {money(s.value)}
                    </ReadableValue>
                  </div>
                ))}
              </div>

              <div className="cap-progress">
                <div
                  className="cap-bar"
                  role="img"
                  aria-label={segments.map((x) => `${x.label} ${money(x.value)}`).join(", ")}
                >
                  {segTotal > 0
                    ? segments.map((x) =>
                        x.value > 0 ? (
                          <span
                            key={x.id}
                            className="cap-bar-seg"
                            style={{ width: `${(x.value / segTotal) * 100}%`, background: x.color }}
                          />
                        ) : null,
                      )
                    : null}
                </div>
                {segTotal > 0 ? (
                  <div className="cap-legend" aria-hidden="true">
                    {segments.map((x) => (
                      <span key={x.id} className="cap-legend-item">
                        <i style={{ background: x.color }} />
                        {x.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className={"cap-band" + (overbudget ? " is-over" : "")}>
                <div className="cap-band-cell">
                  <span className="cap-band-label">Save/mo</span>
                  <ReadableValue as="span" className="cap-band-value">
                    {saveValue}
                  </ReadableValue>
                  <span className="cap-band-sub">{saveSub}</span>
                </div>
                <div className="cap-band-cell">
                  <span className="cap-band-label">Remaining</span>
                  <ReadableValue as="span" className="cap-band-value">
                    {money(m.remainingNeed)}
                  </ReadableValue>
                  <span className="cap-band-sub">
                    {m.budget > 0 ? `of ${money(m.budget)}` : "No budget yet"}
                  </span>
                </div>
              </div>

              <div className="capital-item-list">
                {plan.items.length ? (
                  [...plan.items]
                    .sort((a, b) => Number(a.paid) - Number(b.paid))
                    .map((item) => (
                      <Fragment key={item.id}>
                        <div
                          className={"capital-item-row" + (item.paid ? " capital-item-paid" : "")}
                        >
                          <button
                            type="button"
                            className={"todo-check" + (item.paid ? " checked" : "")}
                            disabled={itemBusy}
                            onClick={() => void togglePaid(plan, item)}
                            aria-label={item.paid ? "Mark unpaid" : "Mark paid"}
                          >
                            {item.paid ? <Icon name="check" size={12} /> : null}
                          </button>
                          <span className="capital-item-name">{item.name}</span>
                          {editingCost === item.id ? (
                            <input
                              autoFocus
                              className="capital-item-cost-in"
                              type="text"
                              inputMode="decimal"
                              value={costDraft}
                              aria-label={`Cost of ${item.name}`}
                              aria-invalid={!!costError || undefined}
                              onChange={(e) => {
                                setCostDraft(e.target.value);
                                setCostError("");
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void commitCost(plan, item);
                                if (e.key === "Escape") cancelEditCost();
                              }}
                              onBlur={() => void commitCost(plan, item)}
                            />
                          ) : (
                            <button
                              type="button"
                              className="capital-item-cost"
                              onClick={() => startEditCost(item)}
                            >
                              {money(
                                item.paid
                                  ? (item.actualCost ?? item.estimatedCost)
                                  : item.estimatedCost,
                              )}
                            </button>
                          )}
                          {!item.paid ? (
                            <button
                              type="button"
                              className="ghost-btn sm"
                              onClick={() => onLogItem(plan, item)}
                            >
                              Log
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="capital-item-remove"
                            disabled={itemBusy}
                            onClick={() =>
                              setConfirmDelete({ type: "item", planId: plan.id, itemId: item.id })
                            }
                            aria-label="Remove item"
                          >
                            <Icon name="close" size={13} />
                          </button>
                        </div>
                        {editingCost === item.id && costError ? (
                          <p className="fld-error" role="alert">
                            {costError}
                          </p>
                        ) : null}
                      </Fragment>
                    ))
                ) : (
                  <p className="panel-sub">No items yet.</p>
                )}
              </div>

              {itemDraftFor === plan.id ? (
                <>
                  <div className="todo-add-row">
                    <input
                      className="text-in"
                      autoFocus
                      value={itemName}
                      aria-label="Item name"
                      onChange={(e) => setItemName(e.target.value)}
                      placeholder="Item name…"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitAddItem(plan);
                        if (e.key === "Escape") setItemDraftFor(null);
                      }}
                    />
                    <input
                      className="text-in capital-item-cost-in"
                      type="text"
                      inputMode="decimal"
                      value={itemCost}
                      aria-label="Estimated cost"
                      aria-invalid={!!itemError || undefined}
                      onChange={(e) => {
                        setItemCost(e.target.value);
                        setItemError("");
                      }}
                      placeholder="0"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitAddItem(plan);
                      }}
                    />
                    <button
                      className="primary-btn"
                      type="button"
                      disabled={itemBusy || !itemName.trim()}
                      onClick={() => void submitAddItem(plan)}
                    >
                      {addingItem ? "Adding…" : "Add"}
                    </button>
                  </div>
                  {itemError ? (
                    <p className="fld-error" role="alert">
                      {itemError}
                    </p>
                  ) : null}
                </>
              ) : (
                <button
                  type="button"
                  className="ghost-btn full capital-add-item-btn"
                  disabled={itemBusy}
                  onClick={() => openAddItem(plan.id)}
                >
                  <Icon name="plus" size={14} /> Add Item
                </button>
              )}
            </div>
          );
        })}
      </div>

      {editor ? (
        <PlanEditor
          key={JSON.stringify(editor)}
          mode={editor}
          plans={plans}
          onSave={saveEditor}
          onClose={() => setEditor(null)}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={confirmDelete.type === "plan" ? "Delete Plan" : "Remove Item"}
          message={
            confirmDelete.type === "plan"
              ? (() => {
                  const plan = plans.find((p) => p.id === confirmDelete.id);
                  if (!plan) return "Delete this plan? This cannot be undone.";
                  const assigned = savingsTxns.filter((e) => e.capitalPlanId === plan.id).length;
                  const saved = planSavedTotal(plan, savingsTxns, categoryIndex);
                  /* Deleting releases them back to their savings envelope, so
                     say where the money goes before it moves. */
                  const released = assigned
                    ? ` Its ${assigned} assigned ${assigned === 1 ? "deposit" : "deposits"} (${money(saved)}) return to your savings envelopes.`
                    : "";
                  return `Delete "${plan.name}" and ${plan.items.length === 1 ? "its 1 line item" : `all ${plan.items.length} of its line items`}?${released} This cannot be undone.`;
                })()
              : (() => {
                  const plan = plans.find((p) => p.id === confirmDelete.planId);
                  const item = plan?.items.find((i) => i.id === confirmDelete.itemId);
                  return `Remove "${item?.name ?? ""}" from this plan? This cannot be undone.`;
                })()
          }
          /* A plan with line items is the costly one to lose: make the user type its name. */
          requireText={
            confirmDelete.type === "plan"
              ? (() => {
                  const plan = plans.find((p) => p.id === confirmDelete.id);

                  return plan?.items.length ? plan.name : undefined;
                })()
              : undefined
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            if (confirmDelete.type === "plan") await removePlan(confirmDelete.id);
            else {
              const plan = plans.find((p) => p.id === confirmDelete.planId);
              if (plan) await removeItem(plan, confirmDelete.itemId);
            }
            setConfirmDelete(null);
          }}
        />
      ) : null}
    </div>
  );
});
