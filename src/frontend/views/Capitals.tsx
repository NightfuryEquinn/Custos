import { Donut } from "@/frontend/charts";
import { DatePicker } from "@/frontend/components/DateTimePicker";
import { ConfirmDialog, EmptyState, Icon } from "@/frontend/components/ui";
import {
  newCapitalItem,
  planBudgetProgress,
  planIsOverbudget,
  planMoney,
  planMonthlySave,
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
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";

/*
 * Capitals — future financial planner
 * ────────────────────────────────────
 * Standalone checklists for big life expenses (marriage, trips, loans, or
 * fully custom plans). Each plan carries a total budget (or falls back to the
 * sum of its item estimates) and an optional target date; monthly save is what
 * is still to set aside — the unpaid budget less the plan's remaining pot —
 * divided by the months left. Savings deposits can optionally be assigned to a
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

type EditorMode = { type: "add-plan" } | { type: "edit-plan"; planId: string } | null;

const ICONS = TODO_ICON_OPTIONS;

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
  const [editor, setEditor] = useState<EditorMode>(null);
  const [templateId, setTemplateId] = useState<CapitalTemplateId>("custom");
  const [name, setName] = useState("");
  const [glyph, setGlyph] = useState("🎯");
  const [targetDate, setTargetDate] = useState("");
  const [initialBudget, setInitialBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [itemDraftFor, setItemDraftFor] = useState<string | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemCost, setItemCost] = useState("");
  const [editingCost, setEditingCost] = useState<string | null>(null);
  const [costDraft, setCostDraft] = useState("");
  const [itemBusy, setItemBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<
    { type: "plan"; id: string } | { type: "item"; planId: string; itemId: string } | null
  >(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    active: !!editor,
  });
  const closeEditor = () => requestClose(() => setEditor(null));

  useEffect(() => {
    setPlans(capitalPlans);
  }, [capitalPlans]);

  const money = (n: number) => fmtMoney(n, { currency });
  const viewRef = useRef<HTMLDivElement>(null);
  useEnter(viewRef);

  const persistPlan = async (data: Partial<CapitalPlan> & { id?: string }) => {
    setBusy(true);
    setError("");
    try {
      const saved = await onSavePlan(data);
      setPlans((prev) =>
        data.id ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved],
      );
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save plan");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const openAddPlan = () => {
    setEditor({ type: "add-plan" });
    setTemplateId("custom");
    setName("");
    setGlyph("🎯");
    setTargetDate("");
    setInitialBudget("");
    setError("");
  };

  useImperativeHandle(ref, () => ({ openAdd: openAddPlan }));

  const openEditPlan = (plan: CapitalPlan) => {
    setEditor({ type: "edit-plan", planId: plan.id });
    setName(plan.name);
    setGlyph(plan.glyph);
    setTargetDate(plan.targetDate ?? "");
    setInitialBudget(
      plan.initialBudget != null && plan.initialBudget > 0 ? String(plan.initialBudget) : "",
    );
    setError("");
  };

  const pickTemplate = (t: CapitalTemplate | null) => {
    if (!t) {
      setTemplateId("custom");
      setGlyph("🎯");
      if (!name) setName("");
      return;
    }
    setTemplateId(t.id);
    setGlyph(t.glyph);
    if (!name) setName(t.name);
  };

  const submitEditor = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!editor) return;

    if (editor.type === "add-plan") {
      const items: CapitalItem[] = [];
      if (templateId !== "custom") {
        const template = CAPITAL_TEMPLATES.find((t) => t.id === templateId);
        for (const itemName of template?.items ?? []) items.push(newCapitalItem(itemName, items));
      }
      const budget = Number(initialBudget) || 0;
      const saved = await persistPlan({
        name: name.trim(),
        glyph,
        templateId,
        targetDate: targetDate || undefined,
        initialBudget: budget,
        createdAt: new Date().toISOString(),
        items,
      });
      if (saved) setEditor(null);
      return;
    }

    const budget = Number(initialBudget) || 0;
    const saved = await persistPlan({
      id: editor.planId,
      name: name.trim(),
      glyph,
      targetDate: targetDate || undefined,
      initialBudget: budget,
    });
    if (saved) setEditor(null);
  };

  const removePlan = async (planId: string) => {
    setBusy(true);
    setError("");
    try {
      await onDeletePlan(planId);
      setPlans((prev) => prev.filter((p) => p.id !== planId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete plan");
    } finally {
      setBusy(false);
    }
  };

  /** Open the inline "add item" draft row for a plan. */
  const openAddItem = (planId: string) => {
    if (itemBusy) return;
    setItemDraftFor(planId);
    setItemName("");
    setItemCost("");
  };

  /** Commit the draft item to a plan and persist. */
  const submitAddItem = async (plan: CapitalPlan) => {
    if (itemBusy) return;
    if (!itemName.trim()) return;
    const item = newCapitalItem(itemName.trim(), plan.items);
    item.estimatedCost = Number(itemCost) || 0;
    setItemDraftFor(null);
    setItemBusy(true);
    try {
      await persistPlan({ id: plan.id, items: [...plan.items, item] });
    } finally {
      setItemBusy(false);
    }
  };

  /** Remove an item from a plan and persist. */
  const removeItem = async (plan: CapitalPlan, itemId: string) => {
    if (itemBusy) return;
    setItemBusy(true);
    try {
      await persistPlan({ id: plan.id, items: plan.items.filter((i) => i.id !== itemId) });
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
  const togglePaid = async (plan: CapitalPlan, item: CapitalItem) => {
    if (itemBusy) return;
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

  /** Open the inline cost editor for an item. */
  const startEditCost = (item: CapitalItem) => {
    setEditingCost(item.id);
    setCostDraft(String(item.estimatedCost || ""));
  };

  /** Commit the edited cost for an item and persist. */
  const commitCost = async (plan: CapitalPlan, item: CapitalItem) => {
    if (itemBusy || editingCost !== item.id) return;

    const value = Number(costDraft) || 0;
    setEditingCost(null);
    if (value === item.estimatedCost) return;

    const items = plan.items.map((i) => (i.id === item.id ? { ...i, estimatedCost: value } : i));
    setItemBusy(true);
    try {
      await persistPlan({ id: plan.id, items });
    } finally {
      setItemBusy(false);
    }
  };

  const editorTitle = editor?.type === "add-plan" ? "New Plan" : editor ? "Edit Plan" : "";

  if (!plans.length && !editor) {
    return (
      <div ref={viewRef} className="view">
        <EmptyState
          title="No Plans Yet"
          sub="Start a plan for a big future expense — set a budget and target date to see how much to save each month."
        />
        {renderEditor()}
      </div>
    );
  }

  function renderEditor() {
    if (!editor) return null;
    return createPortal(
      <div
        ref={scrimRef}
        className="modal-scrim center"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !busy) closeEditor();
        }}
      >
        <div ref={panelRef} className="modal sm" role="dialog" aria-modal="true">
          <div className="modal-head">
            <h3>{editorTitle}</h3>
            <button
              className="icon-btn"
              type="button"
              onClick={closeEditor}
              aria-label="Close"
              disabled={busy}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="modal-body modal-scroll">
            <div className="dm-sec">
              {editor.type === "add-plan" ? (
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
              />

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

              {error ? <p className="auth-error">{error}</p> : null}

              <div className="wallet-form-actions">
                <button
                  className="ghost-btn full"
                  type="button"
                  onClick={closeEditor}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="primary-btn full"
                  type="button"
                  disabled={busy || !name.trim()}
                  onClick={() => void submitEditor()}
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div ref={viewRef} className="view">
      {error ? <p className="auth-error">{error}</p> : null}

      <div className="capital-grid" data-tour="tour-capitals-grid">
        {plans.map((plan) => {
          const m = planMoney(plan, savingsTxns, categoryIndex);
          const progress = planBudgetProgress(plan);
          const overbudget = planIsOverbudget(plan);
          const monthlySave = planMonthlySave(plan, new Date(), savingsTxns, categoryIndex);
          /* Three arcs so the grey one is what is genuinely left to fund, not
             budget − paid: money already in the pot covers part of that. */
          const donutData =
            m.budget > 0
              ? [
                  {
                    id: "paid",
                    value: Math.min(m.paid, m.budget),
                    color: overbudget ? "var(--danger)" : "var(--saved)",
                  },
                  { id: "unspent", value: Math.min(m.unspent, m.outstanding), color: "var(--ok)" },
                  { id: "remain", value: m.remainingNeed, color: "var(--hair)" },
                ]
              : [{ id: "empty", value: 1, color: "var(--hair)" }];

          return (
            <div key={plan.id} className="capital-card">
              <div className="capital-card-head">
                <span className="capital-card-glyph">{plan.glyph}</span>
                <div className="capital-card-title">
                  <h3>{plan.name}</h3>
                  {plan.targetDate ? (
                    <span className="capital-tag">Due {dueDateLabel(plan.targetDate)}</span>
                  ) : null}
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
                    aria-label={busy ? "Removing…" : "Delete Plan"}
                    title={busy ? "Removing…" : "Delete Plan"}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>

              <div className="capital-card-body">
                <div className="capital-ring">
                  <Donut
                    data={donutData}
                    size={120}
                    thickness={20}
                    onHover={() => {}}
                    activeId={null}
                  />
                  <div className="capital-ring-label">
                    {progress !== null ? `${Math.round(progress * 100)}%` : "—"}
                  </div>
                </div>
                <div className="capital-card-stats">
                  <div className="cap-row">
                    <span className="cap-row-label">Total</span>
                    <span className="cap-row-value">{money(m.budget)}</span>
                  </div>
                  <div className="cap-row">
                    <span className="cap-row-label">Paid</span>
                    <span className="cap-row-value">{money(m.paid)}</span>
                  </div>
                  {m.saved > 0 ? (
                    <>
                      <div className="cap-row">
                        <span className="cap-row-label">Saved</span>
                        <span className="cap-row-value">{money(m.saved)}</span>
                      </div>
                      <div className="cap-row">
                        <span className="cap-row-label">Unspent</span>
                        <span className="cap-row-value">{money(m.unspent)}</span>
                      </div>
                    </>
                  ) : null}
                  <div className="cap-divider" />
                  {overbudget ? (
                    <div className="cap-row cap-row--overpaid">Overpaid</div>
                  ) : monthlySave !== null ? (
                    <div className="cap-row">
                      <span className="cap-row-label">Save/mo</span>
                      <span className="cap-row-value">{money(monthlySave)}</span>
                    </div>
                  ) : null}
                  {m.budget > 0 && m.remainingNeed > 0 ? (
                    <div className="cap-row">
                      <span className="cap-row-label">Still to Save</span>
                      <span className="cap-row-value">{money(m.remainingNeed)}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="capital-item-list">
                {plan.items.length ? (
                  [...plan.items]
                    .sort((a, b) => Number(a.paid) - Number(b.paid))
                    .map((item) => (
                      <div
                        key={item.id}
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
                            onChange={(e) => setCostDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void commitCost(plan, item);
                              if (e.key === "Escape") setEditingCost(null);
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
                    ))
                ) : (
                  <p className="panel-sub">No items yet.</p>
                )}
              </div>

              {itemDraftFor === plan.id ? (
                <div className="todo-add-row">
                  <input
                    className="text-in"
                    autoFocus
                    value={itemName}
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
                    onChange={(e) => setItemCost(e.target.value)}
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
                    {itemBusy ? "Adding…" : "Add"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="ghost-btn full capital-add-item-btn"
                  disabled={itemBusy}
                  onClick={() => openAddItem(plan.id)}
                >
                  {itemBusy ? (
                    "Saving…"
                  ) : (
                    <>
                      <Icon name="plus" size={14} /> Add Item
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {renderEditor()}

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
                  return `Delete "${plan.name}" and all ${plan.items.length} of its line items?${released} This cannot be undone.`;
                })()
              : (() => {
                  const plan = plans.find((p) => p.id === confirmDelete.planId);
                  const item = plan?.items.find((i) => i.id === confirmDelete.itemId);
                  return `Remove "${item?.name ?? ""}" from this plan? This cannot be undone.`;
                })()
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
