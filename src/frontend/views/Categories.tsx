import { useEnter, useModalMotion } from "@/frontend/lib/animate";
import { ConfirmDialog, EmptyState, Icon, Segmented, glyphTint } from "@/frontend/components/ui";
import { CategoryColorPicker } from "@/frontend/components/CategoryColorPicker";
import { DatePicker } from "@/frontend/components/DateTimePicker";
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
  | { type: "add-cat"; catType: CategoryType }
  | { type: "add-sub"; catId: string }
  | { type: "edit-cat"; catId: string }
  | { type: "edit-sub"; catId: string; subId: string }
  | null;

const GLYPHS = CATEGORY_GLYPH_OPTIONS;

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
  const [editor, setEditor] = useState<EditorMode>(null);
  const [name, setName] = useState("");
  const [glyph, setGlyph] = useState(DEFAULT_GLYPH);
  const [color, setColor] = useState("#4a6fa5");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<
    { type: "cat"; id: string } | { type: "sub"; catId: string; subId: string } | null
  >(null);
  const [transferSource, setTransferSource] = useState<TransferSource | null>(null);
  const [destCatId, setDestCatId] = useState("");
  const [destSubId, setDestSubId] = useState("");
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const progressRef = useRef<TransferProgress | null>(null);
  const categoriesRef = useRef(categories);
  const transferRetrySource = useRef<TransferSource | null>(null);
  const transferRetryDest = useRef<{ cat: Category; subId: string } | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const transferScrimRef = useRef<HTMLDivElement>(null);
  const transferPanelRef = useRef<HTMLDivElement>(null);
  const progressScrimRef = useRef<HTMLDivElement>(null);
  const progressPanelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    active: !!editor,
  });
  const { requestClose: requestCloseTransfer } = useModalMotion(
    transferScrimRef,
    transferPanelRef,
    { variant: "center", active: !!transferSource && !progress },
  );
  useModalMotion(progressScrimRef, progressPanelRef, {
    variant: "center",
    active: !!progress,
  });
  const closeEditor = () => requestClose(() => setEditor(null));

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

  /** Persist taxonomy changes through the parent save handler. */
  const persist = async (next: Category[]) => {
    setBusy(true);
    setError("");
    try {
      await onSave(next);
      setCategories(next);
      setEditor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save categories");
    } finally {
      setBusy(false);
    }
  };

  /** Open the add-category editor. Type defaults to Expense — switchable via
      the in-modal tab. */
  const openAddCat = () => {
    setEditor({ type: "add-cat", catType: "expense" });
    setName("");
    setGlyph(DEFAULT_GLYPH);
    setColor(nextCategoryColor(categories));
    setTarget("");
    setDeadline("");
    setError("");
  };

  useImperativeHandle(ref, () => ({ openAdd: openAddCat }));

  /** Open the add-subcategory editor. */
  const openAddSub = (catId: string) => {
    setEditor({ type: "add-sub", catId });
    setName("");
    setTarget("");
    setDeadline("");
    setError("");
  };

  /** Open the edit-category editor. */
  const openEditCat = (cat: Category) => {
    setEditor({ type: "edit-cat", catId: cat.id });
    setName(cat.name);
    setGlyph(displayGlyph(cat.glyph, cat.id));
    setColor(cat.color);
    setTarget(cat.target != null ? String(cat.target) : "");
    setDeadline(cat.deadline ?? "");
    setError("");
  };

  /** Open the rename-subcategory editor. */
  const openEditSub = (
    catId: string,
    sub: { id: string; name: string; target?: number; deadline?: string },
  ) => {
    setEditor({ type: "edit-sub", catId, subId: sub.id });
    setName(sub.name);
    setTarget(sub.target != null ? String(sub.target) : "");
    setDeadline(sub.deadline ?? "");
    setError("");
  };

  /** Parse the target field into a nonnegative number, or undefined when unset/invalid. */
  const parsedTarget = () => {
    const n = Number(target.trim());
    return target.trim() && Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const parsedDeadline = () => (deadline.trim() ? deadline.trim() : undefined);

  /**
   * Retire a category. Unused ones are deleted; those with history are archived.
   * Built-in and custom follow the same rule.
   */
  const removeCategory = async (catId: string) => {
    const result = retireCategory(categories, catId, usedSubIds);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await persist(result.categories);
  };

  /** Bring an archived category back into the pickers. */
  const restoreCat = async (catId: string) => {
    await persist(restoreCategory(categories, catId));
  };

  /**
   * Retire a subcategory. Unused → delete; in use → archive. The last remaining
   * sub retires its parent instead.
   */
  const removeSub = async (catId: string, subId: string) => {
    const result = retireSub(categories, catId, subId, usedSubIds);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await persist(result.categories);
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

      await persist(
        removeTransferredSource(
          categoriesRef.current,
          source.type === "cat"
            ? { type: "cat", id: source.catId }
            : { type: "sub", catId: source.catId, subId: source.subId },
        ),
      );
      progressRef.current = null;
      setProgress(null);
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

  /** Commit the active editor mode. */
  const submitEditor = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!editor) return;

    if (editor.type === "add-cat") {
      const id = slugId("cat", name);
      const isSavings = editor.catType === "savings";
      const cat: Category = {
        id,
        name: name.trim(),
        color,
        glyph,
        type: editor.catType,
        builtin: false,
        ...(isSavings ? { target: parsedTarget(), deadline: parsedDeadline() } : {}),
        subs: [{ id: slugId("sub", name), name: name.trim() }],
      };
      await persist([...categories, cat]);
      setExpanded((e) => ({ ...e, [id]: true }));
      return;
    }

    if (editor.type === "add-sub") {
      const parent = categories.find((c) => c.id === editor.catId);
      const isSavings = parent ? resolveCategoryType(parent) === "savings" : false;
      const sub = {
        id: slugId("sub", name),
        name: name.trim(),
        ...(isSavings ? { target: parsedTarget(), deadline: parsedDeadline() } : {}),
      };
      const next = categories.map((c) =>
        c.id === editor.catId ? { ...c, subs: [...c.subs, sub] } : c,
      );
      await persist(next);
      return;
    }

    if (editor.type === "edit-cat") {
      const next = categories.map((c) => {
        if (c.id !== editor.catId) return c;
        const isSavings = resolveCategoryType(c) === "savings";

        return {
          ...c,
          name: name.trim(),
          color,
          glyph,
          ...(isSavings ? { target: parsedTarget(), deadline: parsedDeadline() } : {}),
        };
      });
      await persist(next);
      return;
    }

    if (editor.type === "edit-sub") {
      const parent = categories.find((c) => c.id === editor.catId);
      const isSavings = parent ? resolveCategoryType(parent) === "savings" : false;
      const next = categories.map((c) =>
        c.id === editor.catId
          ? {
              ...c,
              subs: c.subs.map((s) =>
                s.id === editor.subId
                  ? {
                      ...s,
                      name: name.trim(),
                      ...(isSavings ? { target: parsedTarget(), deadline: parsedDeadline() } : {}),
                    }
                  : s,
              ),
            }
          : c,
      );
      await persist(next);
    }
  };

  /** Whether the open editor is scoped to a savings category (target/deadline apply). */
  const editorIsSavings = (() => {
    if (!editor) return false;
    if (editor.type === "add-cat") return editor.catType === "savings";
    if (editor.type === "edit-cat") {
      const cat = categories.find((c) => c.id === editor.catId);
      return cat ? resolveCategoryType(cat) === "savings" : false;
    }
    if (editor.type === "add-sub" || editor.type === "edit-sub") {
      const cat = categories.find((c) => c.id === editor.catId);
      return cat ? resolveCategoryType(cat) === "savings" : false;
    }
    return false;
  })();

  const editorTitle =
    editor?.type === "add-cat"
      ? `Add ${typeLabel(editor.catType)} Category`
      : editor?.type === "add-sub"
        ? "Add Subcategory"
        : editor?.type === "edit-cat"
          ? "Edit Category"
          : editor?.type === "edit-sub"
            ? "Rename Subcategory"
            : "";

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
          <p className="auth-error">{error}</p>
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
                            ? removeCategory(cat.id)
                            : setConfirmDelete({ type: "cat", id: cat.id })
                        }
                        aria-label={
                          busy ? (inUse ? "Archiving" : "Deleting") : inUse ? "Archive" : "Delete"
                        }
                        title={
                          busy
                            ? inUse
                              ? "Archiving…"
                              : "Deleting…"
                            : inUse
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
                                onClick={() => openEditSub(cat.id, sub)}
                                aria-label="Rename"
                                tabIndex={filteredOut || !open ? -1 : undefined}
                              >
                                <Icon name="edit" size={16} />
                              </button>
                              <button
                                type="button"
                                className="danger"
                                disabled={busy}
                                onClick={() =>
                                  used
                                    ? removeSub(cat.id, sub.id)
                                    : setConfirmDelete({
                                        type: "sub",
                                        catId: cat.id,
                                        subId: sub.id,
                                      })
                                }
                                aria-label={
                                  busy
                                    ? used
                                      ? "Archiving"
                                      : "Removing"
                                    : used
                                      ? "Archive"
                                      : "Remove"
                                }
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
                      onClick={() => restoreCat(cat.id)}
                    >
                      {busy ? "Restoring…" : "Restore"}
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
                    onClick={() => persist(restoreSub(categories, cat.id, sub.id))}
                  >
                    Restore
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

      {editor
        ? createPortal(
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
                    {editor.type === "add-cat" ? (
                      <Segmented
                        options={[
                          { v: "expense", label: "Expense" },
                          { v: "savings", label: "Savings" },
                          { v: "income", label: "Income" },
                        ]}
                        value={editor.catType}
                        onChange={(catType) => setEditor({ type: "add-cat", catType })}
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
                      placeholder={
                        editor.type === "add-sub" || editor.type === "edit-sub"
                          ? "Subcategory name"
                          : "Category name"
                      }
                    />

                    {editor.type === "add-cat" || editor.type === "edit-cat" ? (
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

                    {editorIsSavings ? (
                      <>
                        <label className="fld-label" htmlFor="cat-target">
                          Target Amount (optional)
                        </label>
                        <input
                          id="cat-target"
                          className="text-in wallet-field"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="No goal"
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                        />

                        <label className="fld-label" htmlFor="cat-deadline">
                          Deadline (optional)
                        </label>
                        <DatePicker
                          value={deadline}
                          onChange={setDeadline}
                          className="wallet-field"
                        />
                      </>
                    ) : null}

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
                        onClick={submitEditor}
                      >
                        {busy ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {transferSource && transferDestCat
        ? createPortal(
            <div
              ref={transferScrimRef}
              className="modal-scrim center"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget && !busy) {
                  requestCloseTransfer(() => setTransferSource(null));
                }
              }}
            >
              <div ref={transferPanelRef} className="modal sm" role="dialog" aria-modal="true">
                <div className="modal-head">
                  <h3>Transfer</h3>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => requestCloseTransfer(() => setTransferSource(null))}
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
                    {error ? <p className="auth-error">{error}</p> : null}
                    <div className="wallet-form-actions">
                      <button
                        className="ghost-btn full"
                        type="button"
                        onClick={() => requestCloseTransfer(() => setTransferSource(null))}
                      >
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
                  {progress.error ? <p className="auth-error">{progress.error}</p> : null}
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
            if (confirmDelete.type === "cat") await removeCategory(confirmDelete.id);
            else await removeSub(confirmDelete.catId, confirmDelete.subId);
            setConfirmDelete(null);
          }}
        />
      ) : null}
    </div>
  );
});
