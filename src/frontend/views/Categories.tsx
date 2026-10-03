import { useEnter, useModalMotion } from "@/frontend/lib/animate";
import { ConfirmDialog, EmptyState, Icon, Segmented, glyphTint } from "@/frontend/components/ui";
import { CategoryColorPicker } from "@/frontend/components/CategoryColorPicker";
import { DatePicker } from "@/frontend/components/DateTimePicker";
import { isPlainNumber } from "@/frontend/lib/arithmetic";
import { openConfirm, toast } from "@/frontend/lib/feedback";
import {
  liveSubs,
  nextCategoryColor,
  resolveCategoryType,
  slugId,
  type CategoryType,
} from "@/frontend/lib/categories";
import {
  archivedSubsOfLiveParents,
  removeTransferredSource,
  restoreCategory,
  restoreSub,
  retireCategory,
  retireSub,
  typeLabel,
} from "@/frontend/lib/category-retire";
import {
  catSubLabel,
  crossTypeWarning,
  destTypeOf,
  expensesMatchingSubs,
  subIdsOfCategory,
} from "@/frontend/lib/category-transfer";
import type { Category, CategoryIndex, Expense } from "@/frontend/lib/types";
import { CATEGORY_GLYPH_OPTIONS, DEFAULT_GLYPH, displayGlyph } from "@/lib/glyphs";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/*
 * Categories view
 * ───────────────
 * Category / subcategory taxonomy editor: expandable tree with a
 * single modal editor covering add-category, add-subcategory,
 * edit-category and rename-subcategory modes. Built-in and custom
 * entries share delete-if-unused / archive-if-in-use. Archived items
 * can be restored or transferred onto another live subcategory.
 */

type TransferSource =
  { type: "cat"; catId: string } | { type: "sub"; catId: string; subId: string };

type TransferProgress = {
  sourceLabel: string;
  destLabel: string;
  done: number;
  total: number;
  error: string;
  inFlight: boolean;
};

type CategoriesViewProps = {
  categoryIndex: CategoryIndex;
  onSave: (categories: Category[]) => Promise<unknown>;
  /**
   * Subcategory ids that have transaction history — drives archive vs delete.
   * `null` means the history is not loaded yet: retire helpers refuse rather
   * than hard-deleting on a partial answer.
   */
  usedSubIds: Set<string> | null;
  /** Full-history expenses, or null while the unbounded query is in flight. */
  expenses: Expense[] | null;
  /** Paced remap of matching expenses onto a live destination subcategory. */
  onTransfer: (args: {
    sourceSubIds: string[];
    destSubId: string;
    destType: CategoryType;
    destCatId: string;
    sourceCatId?: string;
    onProgress: (done: number, total: number) => void;
  }) => Promise<{ remainingIds: string[]; error?: string }>;
};

type EditorMode =
  | { type: "add-cat" }
  | { type: "add-sub"; catId: string }
  | { type: "edit-cat"; catId: string }
  | { type: "edit-sub"; catId: string; subId: string };

type RetireTarget = { type: "cat"; id: string } | { type: "sub"; catId: string; subId: string };

const GLYPHS = CATEGORY_GLYPH_OPTIONS;

/**
 * Add / edit modal for a category or subcategory. Draft state lives here so the
 * unsaved-changes baseline is taken when the modal opens; `onSave` persists and
 * closes it, and rejects with the reason a save failed.
 */
function CategoryEditor({
  mode,
  categories,
  onSave,
  onClose,
}: {
  mode: EditorMode;
  categories: Category[];
  onSave: (next: Category[], message: string, expandId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const parent = "catId" in mode ? categories.find((c) => c.id === mode.catId) : undefined;
  /* The entry being edited; undefined when adding. */
  const source =
    mode.type === "edit-sub"
      ? parent?.subs.find((s) => s.id === mode.subId)
      : mode.type === "edit-cat"
        ? parent
        : undefined;
  const [catType, setCatType] = useState<CategoryType>("expense");
  const [name, setName] = useState(source?.name ?? "");
  const [glyph, setGlyph] = useState(() =>
    mode.type === "edit-cat" && parent ? displayGlyph(parent.glyph, parent.id) : DEFAULT_GLYPH,
  );
  const [color, setColor] = useState(() =>
    mode.type === "edit-cat" && parent ? parent.color : nextCategoryColor(categories),
  );
  const [target, setTarget] = useState(source?.target != null ? String(source.target) : "");
  const [deadline, setDeadline] = useState(source?.deadline ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  /* See persist's guard in Categories — `saving` state alone can't stop two
     clicks in the same task from both saving. */
  const savingRef = useRef(false);
  const fields = JSON.stringify([catType, name, glyph, color, target, deadline]);
  const [baseline] = useState(fields);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  const { dismiss } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    onDismiss: saving ? false : onClose,
    dirty: fields !== baseline,
  });

  const editing = mode.type === "edit-cat" || mode.type === "edit-sub";
  const isSub = mode.type === "add-sub" || mode.type === "edit-sub";
  /* Target and deadline only apply to savings categories and their subs. */
  const isSavings =
    mode.type === "add-cat"
      ? catType === "savings"
      : parent
        ? resolveCategoryType(parent) === "savings"
        : false;
  const targetText = target.trim();
  const targetValue = targetText ? Number(targetText) : undefined;
  const targetInvalid =
    isSavings && targetText !== "" && !(isPlainNumber(targetText) && Number.isFinite(targetValue));
  const valid = !!name.trim() && !targetInvalid;
  const title =
    mode.type === "add-cat"
      ? `Add ${typeLabel(catType)} Category`
      : mode.type === "add-sub"
        ? "Add Subcategory"
        : mode.type === "edit-cat"
          ? "Edit Category"
          : "Rename Subcategory";

  /** Build the next taxonomy for the open mode and hand it to the parent. */
  const save = async () => {
    if (!valid || saving || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const trimmed = name.trim();
      const savings = isSavings
        ? { target: targetValue, deadline: deadline.trim() || undefined }
        : {};
      if (mode.type === "add-cat") {
        const id = slugId("cat", name);
        const cat: Category = {
          id,
          name: trimmed,
          color,
          glyph,
          type: catType,
          builtin: false,
          ...savings,
          subs: [{ id: slugId("sub", name), name: trimmed }],
        };
        await onSave([...categories, cat], "Category added", id);
      } else if (mode.type === "add-sub") {
        const sub = { id: slugId("sub", name), name: trimmed, ...savings };
        await onSave(
          categories.map((c) => (c.id === mode.catId ? { ...c, subs: [...c.subs, sub] } : c)),
          "Subcategory added",
        );
      } else if (mode.type === "edit-cat") {
        await onSave(
          categories.map((c) =>
            c.id === mode.catId ? { ...c, name: trimmed, color, glyph, ...savings } : c,
          ),
          "Category updated",
        );
      } else {
        await onSave(
          categories.map((c) =>
            c.id === mode.catId
              ? {
                  ...c,
                  subs: c.subs.map((s) =>
                    s.id === mode.subId ? { ...s, name: trimmed, ...savings } : s,
                  ),
                }
              : c,
          ),
          "Subcategory updated",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this category. Please try again.");
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
          <h3>{title}</h3>
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
            {mode.type === "add-cat" ? (
              <Segmented
                options={[
                  { v: "expense", label: "Expense" },
                  { v: "savings", label: "Savings" },
                  { v: "income", label: "Income" },
                ]}
                value={catType}
                onChange={setCatType}
              />
            ) : null}

            <label className="fld-label" htmlFor="cat-name">
              Name
            </label>
            <input
              id="cat-name"
              className="text-in wallet-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder={isSub ? "Subcategory name" : "Category name"}
            />

            {mode.type === "add-cat" || mode.type === "edit-cat" ? (
              <>
                <label className="fld-label">Color</label>
                <CategoryColorPicker value={color} onChange={setColor} />

                <label className="fld-label">Icon</label>
                <div className="cat-glyph-row">
                  {GLYPHS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      className={"cat-glyph-btn" + (glyph === g ? " active" : "")}
                      style={glyph === g ? { borderColor: color, color } : undefined}
                      onClick={() => setGlyph(g)}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {isSavings ? (
              <>
                <label className="fld-label" htmlFor="cat-target">
                  Target Amount (optional)
                </label>
                <input
                  id="cat-target"
                  className="text-in wallet-field"
                  type="text"
                  inputMode="decimal"
                  placeholder="No goal"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  aria-invalid={targetInvalid || undefined}
                />
                {targetInvalid ? (
                  <p className="fld-error">Enter a number of 0 or more, or leave it blank.</p>
                ) : null}

                <label className="fld-label" htmlFor="cat-deadline">
                  Deadline (optional)
                </label>
                <DatePicker value={deadline} onChange={setDeadline} className="wallet-field" />
              </>
            ) : null}

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
              {saving
                ? "Saving…"
                : editing
                  ? "Save Changes"
                  : isSub
                    ? "Add Subcategory"
                    : "Add Category"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** Imperative handle so the shell's quick-add FAB can trigger New Category. */
export type CategoriesHandle = { openAdd: () => void };

export const Categories = forwardRef<CategoriesHandle, CategoriesViewProps>(function Categories(
  { categoryIndex, onSave, usedSubIds, expenses, onTransfer },
  ref,
) {
  // Hold the FULL taxonomy: `persist` writes this list wholesale, so dropping
  // archived entries here would delete them on the next save.
  const [categories, setCategories] = useState(categoryIndex.allCategories);
  const [filter, setFilter] = useState<"all" | CategoryType>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [busy, setBusy] = useState(false);
  /* Which archived row's Restore is running, so only that button says Restoring…. */
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState("");
  /* `busy` state can't stop two clicks landing in the same task from both
     calling persist before either's setBusy(true) commits — a ref flips
     synchronously, so the second call always sees it. */
  const persistingRef = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState<RetireTarget | null>(null);
  const [transferSource, setTransferSource] = useState<TransferSource | null>(null);
  const [destCatId, setDestCatId] = useState("");
  const [destSubId, setDestSubId] = useState("");
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const progressRef = useRef<TransferProgress | null>(null);
  const categoriesRef = useRef(categories);
  const transferRetrySource = useRef<TransferSource | null>(null);
  const transferRetryDest = useRef<{ cat: Category; subId: string } | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const transferScrimRef = useRef<HTMLDivElement>(null);
  const transferPanelRef = useRef<HTMLDivElement>(null);
  const progressScrimRef = useRef<HTMLDivElement>(null);
  const progressPanelRef = useRef<HTMLDivElement>(null);
  /* The progress dialog passes no onDismiss: it must not close on Escape or
     backdrop while a transfer is running. */
  useModalMotion(progressScrimRef, progressPanelRef, {
    variant: "center",
    active: !!progress,
  });

  useEffect(() => {
    setCategories(categoryIndex.allCategories);
  }, [categoryIndex.allCategories]);

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  const activeCategories = categories.filter((c) => !c.archived);
  const archivedCategories = categories.filter((c) => Boolean(c.archived));
  const archivedLiveSubs = archivedSubsOfLiveParents(categories);
  const destCategories = useMemo(
    () =>
      categories
        .filter((c) => !c.archived)
        .map((c) => ({ ...c, subs: liveSubs(c) }))
        .filter((c) => c.subs.length > 0),
    [categories],
  );

  /** Whether a category matches the active type filter. */
  const catMatches = (cat: Category) => {
    if (filter === "all") return true;

    return resolveCategoryType(cat) === filter;
  };
  const visibleCount = activeCategories.reduce((n, c) => n + (catMatches(c) ? 1 : 0), 0);

  /** True when any of the category's subs carries transaction history. */
  const catInUse = (cat: Category) =>
    usedSubIds === null || cat.subs.some((s) => usedSubIds.has(s.id));

  /** True when this subcategory has transaction history. */
  const subInUse = (subId: string) => usedSubIds === null || usedSubIds.has(subId);

  /**
   * Persist taxonomy changes through the parent save handler. Resolves true once
   * saved, false when another save is already running, and rejects on failure so
   * each caller can show the reason where the user is looking.
   */
  const persist = async (next: Category[]) => {
    if (persistingRef.current) return false;
    persistingRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave(next);
      setCategories(next);
      setEditor(null);

      return true;
    } finally {
      persistingRef.current = false;
      setBusy(false);
    }
  };

  /** Open the add-category editor. Type defaults to Expense — switchable via
      the in-modal tab. */
  const openAddCat = () => {
    setEditor({ type: "add-cat" });
    setError("");
  };

  useImperativeHandle(ref, () => ({ openAdd: openAddCat }));

  /** Open the add-subcategory editor. */
  const openAddSub = (catId: string) => {
    setEditor({ type: "add-sub", catId });
    setError("");
  };

  /** Open the edit-category editor. */
  const openEditCat = (cat: Category) => {
    setEditor({ type: "edit-cat", catId: cat.id });
    setError("");
  };

  /** Open the rename-subcategory editor. */
  const openEditSub = (catId: string, subId: string) => {
    setEditor({ type: "edit-sub", catId, subId });
    setError("");
  };

  /** Persist the editor's result, then confirm it with a toast. */
  const saveEditor = async (next: Category[], message: string, expandId?: string) => {
    if (!(await persist(next))) return;
    toast(message);
    if (expandId) setExpanded((e) => ({ ...e, [expandId]: true }));
  };

  /** What retiring this entry would do, or why it can't be done. */
  const planRetire = (target: RetireTarget) =>
    target.type === "cat"
      ? retireCategory(categories, target.id, usedSubIds)
      : retireSub(categories, target.catId, target.subId, usedSubIds);

  /**
   * Retire a category or subcategory. Unused ones are deleted; those with history
   * are archived. Built-in and custom follow the same rule. Rejects with the
   * reason it can't, so the confirm dialog shows it.
   */
  const retire = async (target: RetireTarget, verb: "deleted" | "archived") => {
    const result = planRetire(target);
    if (!result.ok) throw new Error(result.error);
    if (await persist(result.categories)) {
      toast(`${target.type === "cat" ? "Category" : "Subcategory"} ${verb}`);
    }
  };

  /** Archive keeps history and is reversible: one confirm, no arming. */
  const askArchive = (target: RetireTarget) => {
    const plan = planRetire(target);
    if (!plan.ok) {
      setError(plan.error);
      return;
    }
    const cat = categories.find((c) => c.id === (target.type === "cat" ? target.id : target.catId));
    const label =
      target.type === "cat" ? cat?.name : cat?.subs.find((s) => s.id === target.subId)?.name;
    /* Retiring a parent's last live sub archives the parent too. */
    const parentToo =
      target.type === "sub" && plan.categories.find((c) => c.id === target.catId)?.archived;
    openConfirm({
      title: target.type === "cat" ? "Archive Category" : "Archive Subcategory",
      message:
        `"${label ?? ""}" has transactions, so it will be archived rather than deleted.` +
        (parentToo
          ? ` It is the last active subcategory, so "${cat?.name}" is archived too.`
          : "") +
        " You can restore it any time.",
      confirmLabel: "Archive",
      pendingLabel: "Archiving…",
      arm: false,
      onConfirm: () => retire(target, "archived"),
    });
  };

  /** Bring an archived category or subcategory back into the pickers. */
  const restore = async (rowId: string, next: Category[], label: string) => {
    setRestoringId(rowId);
    try {
      if (await persist(next)) toast(`${label} restored`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore. Please try again.");
    } finally {
      setRestoringId(null);
    }
  };

  /** Source subcategory ids for a transfer. */
  const sourceIdsFor = (source: TransferSource) => {
    if (source.type === "cat") {
      const cat = categories.find((c) => c.id === source.catId);
      return cat ? subIdsOfCategory(cat) : [];
    }
    return [source.subId];
  };

  /** Display label for a transfer source. */
  const sourceLabelFor = (source: TransferSource) => {
    const cat = categories.find((c) => c.id === source.catId);
    if (!cat) return "";
    return source.type === "cat" ? cat.name : catSubLabel(cat, source.subId);
  };

  /** Open the destination picker for an archived item. */
  const openTransfer = (source: TransferSource) => {
    const first = destCategories[0];
    const firstSub = first?.subs[0];
    setTransferSource(source);
    setDestCatId(first?.id ?? "");
    setDestSubId(firstSub?.id ?? "");
    setError("");
  };

  /** Run (or retry) a transfer onto the chosen destination. */
  const runTransfer = async (source: TransferSource, destCat: Category, destSub: string) => {
    const sourceIds = sourceIdsFor(source);
    const blocked = new Set(source.type === "sub" ? [source.subId] : sourceIds);
    if (blocked.has(destSub)) {
      setError("Pick a different subcategory than the one you are transferring.");
      return;
    }

    const matching = expensesMatchingSubs(expenses ?? [], new Set(sourceIds));
    const sourceLabel = sourceLabelFor(source);
    const destLabel = catSubLabel(destCat, destSub);
    const nextProgress: TransferProgress = {
      sourceLabel,
      destLabel,
      done: 0,
      total: matching.length,
      error: "",
      inFlight: true,
    };
    progressRef.current = nextProgress;
    setProgress(nextProgress);
    setTransferSource(null);

    const applyProgress = (done: number, total: number) => {
      const cur = progressRef.current;
      if (!cur) return;
      const updated = { ...cur, done, total };
      progressRef.current = updated;
      setProgress(updated);
    };

    try {
      if (matching.length) {
        const result = await onTransfer({
          sourceSubIds: sourceIds,
          destSubId: destSub,
          destType: destTypeOf(destCat),
          destCatId: destCat.id,
          sourceCatId: source.type === "cat" ? source.catId : undefined,
          onProgress: applyProgress,
        });
        if (result.remainingIds.length) {
          const failed: TransferProgress = {
            ...progressRef.current!,
            inFlight: false,
            error: result.error || "Transfer stopped before every transaction was moved.",
          };
          progressRef.current = failed;
          setProgress(failed);
          return;
        }
      }

      const removed = await persist(
        removeTransferredSource(
          categoriesRef.current,
          source.type === "cat"
            ? { type: "cat", id: source.catId }
            : { type: "sub", catId: source.catId, subId: source.subId },
        ),
      );
      progressRef.current = null;
      setProgress(null);
      if (removed) toast("Transfer complete");
    } catch (err) {
      const failed: TransferProgress = {
        ...(progressRef.current ?? nextProgress),
        inFlight: false,
        error: err instanceof Error ? err.message : "Transfer failed",
      };
      progressRef.current = failed;
      setProgress(failed);
    }
  };

  /** Retry remaining work after a failed transfer. */
  const retryTransfer = async () => {
    if (!progress || transferRetrySource.current == null || transferRetryDest.current == null) {
      return;
    }
    await runTransfer(
      transferRetrySource.current,
      transferRetryDest.current.cat,
      transferRetryDest.current.subId,
    );
  };

  const transferDestCat = destCategories.find((c) => c.id === destCatId) ?? destCategories[0];
  const transferDestSubs = transferDestCat?.subs ?? [];
  const transferCount = transferSource
    ? expensesMatchingSubs(expenses ?? [], new Set(sourceIdsFor(transferSource))).length
    : 0;
  const transferSourceCat = transferSource
    ? categories.find((c) => c.id === transferSource.catId)
    : undefined;
  const transferTypeWarning =
    transferSource && transferSourceCat && transferDestCat
      ? crossTypeWarning(
          transferCount,
          sourceLabelFor(transferSource),
          catSubLabel(transferDestCat, destSubId),
          resolveCategoryType(transferSourceCat),
          destTypeOf(transferDestCat),
        )
      : null;
  /* Dismissable only while picking a destination; once a transfer runs the
     progress dialog takes over and cannot be closed from the keyboard. */
  const { dismiss: dismissTransfer } = useModalMotion(transferScrimRef, transferPanelRef, {
    variant: "center",
    active: !!transferSource && !!transferDestCat && !progress,
    onDismiss: () => setTransferSource(null),
  });

  useEnter(viewRef);

  return (
    <div ref={viewRef} className="view">
      <div className="cat-toolbar" data-tour="tour-categories-toolbar">
        <Segmented
          options={[
            { v: "all", label: "All" },
            { v: "expense", label: "Expense" },
            { v: "savings", label: "Savings" },
            { v: "income", label: "Income" },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Your Taxonomy</h2>
          </div>
        </div>

        {error && !editor && !transferSource && !progress ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="cat-tree" data-tour="tour-categories-tree">
          {activeCategories.length ? (
            activeCategories.map((cat) => {
              const catType = resolveCategoryType(cat);
              const open = expanded[cat.id] ?? true;
              const filteredOut = !catMatches(cat);
              const live = liveSubs(cat);
              const inUse = catInUse(cat);

              return (
                <div
                  key={cat.id}
                  className={
                    "cat-block" +
                    (open ? "" : " is-collapsed") +
                    (filteredOut ? " is-filtered-out" : "")
                  }
                  aria-hidden={filteredOut || undefined}
                >
                  <div className="cat-block-head">
                    <button
                      type="button"
                      className="cat-expand"
                      onClick={() => setExpanded((e) => ({ ...e, [cat.id]: !open }))}
                      aria-expanded={open}
                      tabIndex={filteredOut ? -1 : undefined}
                    >
                      <Icon name="chevD" size={16} />
                    </button>
                    <span className="cat-block-glyph" style={glyphTint(cat.color)}>
                      {displayGlyph(cat.glyph, cat.id)}
                    </span>
                    <div className="cat-block-main">
                      <div className="cat-block-name">{cat.name}</div>
                      <div className="cat-block-tags">
                        {cat.builtin ? <span className="wallet-badge">Built-in</span> : null}
                        <span className="wallet-badge">{typeLabel(catType)}</span>
                      </div>
                    </div>
                    <div className="cat-block-actions">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openEditCat(cat)}
                        aria-label="Edit"
                        tabIndex={filteredOut ? -1 : undefined}
                      >
                        <Icon name="edit" size={16} />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openAddSub(cat.id)}
                        aria-label="Add Subcategory"
                        tabIndex={filteredOut ? -1 : undefined}
                      >
                        <Icon name="plus" size={16} />
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        onClick={() =>
                          inUse
                            ? askArchive({ type: "cat", id: cat.id })
                            : setConfirmDelete({ type: "cat", id: cat.id })
                        }
                        aria-label={inUse ? "Archive" : "Delete"}
                        title={
                          inUse
                            ? "Archive — keeps past transactions classified correctly"
                            : "Delete"
                        }
                        tabIndex={filteredOut ? -1 : undefined}
                      >
                        <Icon name={inUse ? "archive" : "trash"} size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="cat-sub-reveal">
                    <ul className="cat-sub-list">
                      {live.map((sub) => {
                        const used = subInUse(sub.id);

                        return (
                          <li key={sub.id} className="cat-sub-row">
                            <span className="cat-sub-name">{sub.name}</span>
                            <div className="cat-sub-actions">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openEditSub(cat.id, sub.id)}
                                aria-label="Rename"
                                tabIndex={filteredOut || !open ? -1 : undefined}
                              >
                                <Icon name="edit" size={16} />
                              </button>
                              <button
                                type="button"
                                className="danger"
                                disabled={busy}
                                onClick={() => {
                                  const target = {
                                    type: "sub" as const,
                                    catId: cat.id,
                                    subId: sub.id,
                                  };
                                  if (used) askArchive(target);
                                  else setConfirmDelete(target);
                                }}
                                aria-label={used ? "Archive" : "Remove"}
                                title={
                                  used
                                    ? "Archive — keeps past transactions classified correctly"
                                    : "Delete"
                                }
                                tabIndex={filteredOut || !open ? -1 : undefined}
                              >
                                <Icon name={used ? "archive" : "trash"} size={16} />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyState
              title="No Categories"
              sub="Add a category to start organizing transactions."
            />
          )}
          {activeCategories.length && !visibleCount ? (
            <EmptyState title="Nothing Matches" sub="Try a different filter." />
          ) : null}
        </div>
      </section>

      {archivedCategories.length || archivedLiveSubs.length ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Archived</h2>
              <p className="panel-sub">
                Retired categories and subcategories, kept so past transactions keep their type.
                Restore them, or transfer their history onto another category and remove them.
              </p>
            </div>
          </div>

          <div className="cat-archived-list">
            {archivedCategories.map((cat) => (
              <div key={cat.id} className="cat-archived-group">
                <div className="cat-archived-row">
                  <span className="cat-block-glyph" style={glyphTint(cat.color)}>
                    {displayGlyph(cat.glyph, cat.id)}
                  </span>
                  <div className="cat-archived-copy">
                    <div className="cat-block-name">{cat.name}</div>
                    <div className="cat-block-tags">
                      {cat.builtin ? <span className="wallet-badge">Built-in</span> : null}
                      <span className="wallet-badge">{typeLabel(resolveCategoryType(cat))}</span>
                    </div>
                  </div>
                  <div className="cat-archived-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy || !!progress}
                      onClick={() =>
                        void restore(
                          `cat:${cat.id}`,
                          restoreCategory(categories, cat.id),
                          "Category",
                        )
                      }
                    >
                      {restoringId === `cat:${cat.id}` ? "Restoring…" : "Restore"}
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy || expenses === null || !!progress}
                      onClick={() => openTransfer({ type: "cat", catId: cat.id })}
                    >
                      Transfer
                    </button>
                  </div>
                </div>
                {cat.subs.length > 1 ? (
                  <ul className="cat-archived-subs">
                    {cat.subs.map((sub) => (
                      <li key={sub.id} className="cat-archived-sub">
                        <span>{sub.name}</span>
                        <button
                          type="button"
                          className="ghost-btn"
                          disabled={busy || expenses === null || !!progress}
                          onClick={() =>
                            openTransfer({ type: "sub", catId: cat.id, subId: sub.id })
                          }
                        >
                          Transfer
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
            {archivedLiveSubs.map(({ cat, sub }) => (
              <div key={sub.id} className="cat-archived-row">
                <span className="cat-block-glyph" style={glyphTint(cat.color)}>
                  {displayGlyph(cat.glyph, cat.id)}
                </span>
                <div className="cat-archived-copy">
                  <div className="cat-block-name">{catSubLabel(cat, sub.id)}</div>
                  <div className="cat-block-tags">
                    <span className="wallet-badge">Subcategory</span>
                    <span className="wallet-badge">{typeLabel(resolveCategoryType(cat))}</span>
                  </div>
                </div>
                <div className="cat-archived-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy || !!progress}
                    onClick={() =>
                      void restore(
                        `sub:${sub.id}`,
                        restoreSub(categories, cat.id, sub.id),
                        "Subcategory",
                      )
                    }
                  >
                    {restoringId === `sub:${sub.id}` ? "Restoring…" : "Restore"}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy || expenses === null || !!progress}
                    onClick={() => openTransfer({ type: "sub", catId: cat.id, subId: sub.id })}
                  >
                    Transfer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {editor ? (
        <CategoryEditor
          key={JSON.stringify(editor)}
          mode={editor}
          categories={categories}
          onSave={saveEditor}
          onClose={() => setEditor(null)}
        />
      ) : null}

      {transferSource && transferDestCat
        ? createPortal(
            <div
              ref={transferScrimRef}
              className="modal-scrim center"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) dismissTransfer();
              }}
            >
              <div ref={transferPanelRef} className="modal sm" role="dialog" aria-modal="true">
                <div className="modal-head">
                  <h3>Transfer</h3>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={dismissTransfer}
                    aria-label="Close"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
                <div className="modal-body modal-scroll">
                  <div className="dm-sec">
                    <p className="panel-sub">
                      Move {sourceLabelFor(transferSource)} onto another category. This will update{" "}
                      {transferCount} {transferCount === 1 ? "transaction" : "transactions"}.
                    </p>
                    <label className="fld-label">Category</label>
                    <div className="cat-grid">
                      {destCategories.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={"cat-chip" + (c.id === destCatId ? " active" : "")}
                          style={
                            c.id === destCatId
                              ? { borderColor: c.color, background: c.color + "16" }
                              : undefined
                          }
                          onClick={() => {
                            setDestCatId(c.id);
                            setDestSubId(c.subs[0]?.id ?? "");
                          }}
                        >
                          <span className="cc-glyph" style={{ color: c.color }}>
                            {displayGlyph(c.glyph, c.id)}
                          </span>
                          <span className="cc-label">{c.name}</span>
                        </button>
                      ))}
                    </div>
                    <label className="fld-label">Subcategory</label>
                    <div className="sub-row">
                      {transferDestSubs.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={"sub-chip" + (s.id === destSubId ? " active" : "")}
                          onClick={() => setDestSubId(s.id)}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                    {transferTypeWarning ? (
                      <p className="auth-error">{transferTypeWarning}</p>
                    ) : null}
                    {error ? (
                      <p className="auth-error auth-error--gap" role="alert">
                        {error}
                      </p>
                    ) : null}
                    <div className="wallet-form-actions">
                      <button className="ghost-btn full" type="button" onClick={dismissTransfer}>
                        Cancel
                      </button>
                      <button
                        className="primary-btn full"
                        type="button"
                        disabled={!destSubId}
                        onClick={() => {
                          transferRetrySource.current = transferSource;
                          transferRetryDest.current = {
                            cat: transferDestCat,
                            subId: destSubId,
                          };
                          void runTransfer(transferSource, transferDestCat, destSubId);
                        }}
                      >
                        Transfer
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {progress
        ? createPortal(
            <div ref={progressScrimRef} className="modal-scrim center">
              <div
                ref={progressPanelRef}
                className="modal sm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="cat-transfer-title"
              >
                <div className="modal-head">
                  <h3 id="cat-transfer-title">
                    {progress.inFlight ? "Transferring…" : "Transfer paused"}
                  </h3>
                </div>
                <div className="modal-body">
                  <p className="panel-sub">
                    {progress.sourceLabel} → {progress.destLabel}
                  </p>
                  <p className="panel-sub num">
                    {progress.done} / {progress.total}
                  </p>
                  <div className="profile-progress" aria-hidden>
                    <div
                      className="profile-progress-fill"
                      style={{
                        width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 100}%`,
                      }}
                    />
                  </div>
                  {progress.error ? (
                    <p className="auth-error" role="alert">
                      {progress.error}
                    </p>
                  ) : null}
                  {!progress.inFlight ? (
                    <div className="wallet-form-actions">
                      <button
                        className="ghost-btn full"
                        type="button"
                        onClick={() => {
                          progressRef.current = null;
                          setProgress(null);
                        }}
                      >
                        Close
                      </button>
                      <button
                        className="primary-btn full"
                        type="button"
                        onClick={() => void retryTransfer()}
                      >
                        Retry remaining
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={confirmDelete.type === "cat" ? "Delete Category" : "Remove Subcategory"}
          message={
            confirmDelete.type === "cat"
              ? `Delete "${categories.find((c) => c.id === confirmDelete.id)?.name ?? ""}"? This cannot be undone.`
              : `Remove "${
                  categories
                    .find((c) => c.id === confirmDelete.catId)
                    ?.subs.find((s) => s.id === confirmDelete.subId)?.name ?? ""
                }" from ${categories.find((c) => c.id === confirmDelete.catId)?.name ?? "this category"}? This cannot be undone.`
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await retire(confirmDelete, "deleted");
            setConfirmDelete(null);
          }}
        />
      ) : null}
    </div>
  );
});
