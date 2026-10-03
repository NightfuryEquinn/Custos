import { useEnter, useModalMotion } from "@/frontend/lib/animate";
import { ConfirmDialog, EmptyState, Icon } from "@/frontend/components/ui";
import { slugId } from "@/frontend/lib/categories";
import { toast } from "@/frontend/lib/feedback";
import type { TodoList, TodoTask } from "@/frontend/lib/types";
import { TODO_ICON_OPTIONS } from "@/lib/glyphs";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/*
 * TO-DO List view
 * ───────────────
 * Multiple named lists shown as tabs; the active list's tasks can be
 * added, toggled and removed inline. A single modal handles list
 * creation and renaming.
 */

const ICONS = TODO_ICON_OPTIONS;

type TodoListViewProps = {
  todoLists: TodoList[];
  onSave: (
    data: Partial<TodoList> & { id?: string; name?: string; icon?: string },
  ) => Promise<TodoList>;
  onDelete: (id: string) => Promise<unknown>;
};

/** Imperative handle so the shell's quick-add FAB can trigger New List. */
export type TodoListViewHandle = { openAdd: () => void };

type EditorMode = { type: "add-list" } | { type: "edit-list"; listId: string } | null;

function taskId(title: string, existing: TodoTask[]) {
  const base = slugId("task", title);
  if (!existing.some((t) => t.id === base)) return base;
  return `${base}_${Date.now().toString(36).slice(-4)}`;
}

export const TodoListView = forwardRef<TodoListViewHandle, TodoListViewProps>(function TodoListView(
  { todoLists, onSave, onDelete },
  ref,
) {
  const [lists, setLists] = useState(todoLists);
  const [activeId, setActiveId] = useState<string | null>(todoLists[0]?.id ?? null);
  const [editor, setEditor] = useState<EditorMode>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>("📋");
  const [taskDraft, setTaskDraft] = useState("");
  const [savingList, setSavingList] = useState(false);
  const [deletingList, setDeletingList] = useState(false);
  /* Which task action is in flight, so only that button shows its busy label. */
  const [taskPending, setTaskPending] = useState<{
    kind: "add" | "remove" | "toggle";
    id?: string;
  } | null>(null);
  const busy = savingList || deletingList || !!taskPending;
  const [error, setError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<
    { type: "list"; id: string } | { type: "task"; listId: string; taskId: string } | null
  >(null);
  const taskSaveRef = useRef(false);
  /* Same shape as taskSaveRef — `savingList` state can't stop two clicks landing
     in the same task from both calling submitEditor before either's
     setSavingList(true) commits. */
  const persistListRef = useRef(false);
  const fields = JSON.stringify([name, icon]);
  const [baseline, setBaseline] = useState(fields);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  const { dismiss } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    active: !!editor,
    onDismiss: savingList || deletingList ? false : () => setEditor(null),
    dirty: fields !== baseline,
  });

  useEffect(() => {
    setLists(todoLists);
    if (!activeId && todoLists.length) setActiveId(todoLists[0]?.id ?? null);
    if (activeId && !todoLists.some((l) => l.id === activeId)) {
      setActiveId(todoLists[0]?.id ?? null);
    }
  }, [todoLists, activeId]);

  const active = useMemo(() => lists.find((l) => l.id === activeId) ?? null, [lists, activeId]);

  /** Persist a task change. Throws on failure so each caller picks where the error shows. */
  const updateTasks = async (
    listId: string,
    tasks: TodoTask[],
    pending: NonNullable<typeof taskPending>,
  ) => {
    if (taskSaveRef.current) return false;

    taskSaveRef.current = true;
    setTaskPending(pending);
    setError("");
    try {
      const saved = await onSave({ id: listId, tasks });
      setLists((prev) => prev.map((l) => (l.id === saved.id ? saved : l)));
      return true;
    } finally {
      taskSaveRef.current = false;
      setTaskPending(null);
    }
  };

  const openAddList = () => {
    setEditor({ type: "add-list" });
    setName("");
    setIcon("📋");
    setBaseline(JSON.stringify(["", "📋"]));
    setEditorError("");
  };

  useImperativeHandle(ref, () => ({ openAdd: openAddList }));

  const openEditList = (list: TodoList) => {
    setEditor({ type: "edit-list", listId: list.id });
    setName(list.name);
    setIcon(list.icon);
    setBaseline(JSON.stringify([list.name, list.icon]));
    setEditorError("");
  };

  /** Errors propagate to the ConfirmDialog, which shows them inline. */
  const removeList = async (listId: string) => {
    setDeletingList(true);
    try {
      await onDelete(listId);
      setLists((prev) => prev.filter((l) => l.id !== listId));
      if (activeId === listId) {
        const next = lists.filter((l) => l.id !== listId);
        setActiveId(next[0]?.id ?? null);
      }
      toast("List deleted");
      setEditor(null);
    } finally {
      setDeletingList(false);
    }
  };

  const submitEditor = async () => {
    if (!name.trim()) {
      setEditorError("Name is required");
      return;
    }
    if (!editor || persistListRef.current) return;

    persistListRef.current = true;
    setSavingList(true);
    setEditorError("");
    try {
      const data =
        editor.type === "add-list"
          ? { name: name.trim(), icon }
          : { id: editor.listId, name: name.trim(), icon };
      const saved = await onSave(data);
      setLists((prev) =>
        "id" in data ? prev.map((l) => (l.id === saved.id ? saved : l)) : [...prev, saved],
      );
      if (!("id" in data)) setActiveId(saved.id);
      toast(editor.type === "add-list" ? "List added" : "List updated");
      setEditor(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not save list");
    } finally {
      persistListRef.current = false;
      setSavingList(false);
    }
  };

  const addTask = async () => {
    if (!active || !taskDraft.trim()) return;
    const title = taskDraft.trim();
    const task: TodoTask = { id: taskId(title, active.tasks), title, done: false };
    try {
      /* Keep the text on failure; only clear it if it hasn't been edited meanwhile. */
      if (await updateTasks(active.id, [...active.tasks, task], { kind: "add" })) {
        setTaskDraft((draft) => (draft.trim() === title ? "" : draft));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add task");
    }
  };

  const toggleTask = async (listId: string, taskId: string) => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    const tasks = list.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t));
    try {
      await updateTasks(listId, tasks, { kind: "toggle", id: taskId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update task");
    }
  };

  /** Errors propagate to the ConfirmDialog, which shows them inline. */
  const removeTask = async (listId: string, taskId: string) => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    const tasks = list.tasks.filter((t) => t.id !== taskId);
    if (!(await updateTasks(listId, tasks, { kind: "remove", id: taskId }))) {
      throw new Error("Another change is still saving. Try again in a moment.");
    }
    toast("Task removed");
  };

  const deleteTarget = confirmDelete
    ? lists.find(
        (l) => l.id === (confirmDelete.type === "list" ? confirmDelete.id : confirmDelete.listId),
      )
    : undefined;
  const editorTitle = editor?.type === "add-list" ? "New List" : editor ? "Edit List" : "";
  const viewRef = useRef<HTMLDivElement>(null);
  useEnter(viewRef);

  return (
    <div ref={viewRef} className="view">
      {lists.length ? (
        <>
          <div className="todo-list-tabs" data-tour="tour-todos-tabs">
            {lists.map((list) => {
              const done = list.tasks.filter((t) => t.done).length;
              const selected = list.id === activeId;
              return (
                <button
                  key={list.id}
                  type="button"
                  className={"todo-tab" + (selected ? " active" : "")}
                  onClick={() => setActiveId(list.id)}
                >
                  <span className="todo-tab-icon">{list.icon}</span>
                  <span className="todo-tab-name">{list.name}</span>
                  <span className="todo-tab-count">
                    {done}/{list.tasks.length}
                  </span>
                </button>
              );
            })}
          </div>

          {active ? (
            <section className="panel" data-tour="tour-todos-tasks">
              <div className="panel-head panel-head--todo">
                <div className="todo-panel-title">
                  <span className="todo-panel-icon">{active.icon}</span>
                  <div>
                    <h2>{active.name}</h2>
                    <p className="panel-sub">
                      {active.tasks.filter((t) => t.done).length} of {active.tasks.length} done
                    </p>
                  </div>
                </div>
                <div className="todo-panel-actions">
                  <button type="button" onClick={() => openEditList(active)} aria-label="Edit List">
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => setConfirmDelete({ type: "list", id: active.id })}
                    aria-label={deletingList ? "Deleting…" : "Delete List"}
                    title={deletingList ? "Deleting…" : "Delete List"}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>

              <div className="todo-task-list">
                {active.tasks.length ? (
                  [...active.tasks]
                    .sort((a, b) => Number(a.done) - Number(b.done))
                    .map((task) => (
                      <div key={task.id} className={"todo-task" + (task.done ? " done" : "")}>
                        <button
                          type="button"
                          className={"todo-check" + (task.done ? " checked" : "")}
                          disabled={busy}
                          onClick={() => toggleTask(active.id, task.id)}
                          aria-label={task.done ? "Mark incomplete" : "Mark complete"}
                        >
                          {task.done ? <Icon name="check" size={14} /> : null}
                        </button>
                        <span className="todo-task-title">{task.title}</span>
                        <button
                          type="button"
                          className="ghost-btn sm danger"
                          disabled={busy}
                          onClick={() =>
                            setConfirmDelete({ type: "task", listId: active.id, taskId: task.id })
                          }
                        >
                          {taskPending?.kind === "remove" && taskPending.id === task.id
                            ? "Removing…"
                            : "Remove"}
                        </button>
                      </div>
                    ))
                ) : (
                  <EmptyState title="No Tasks Yet" sub="Add your first task below." />
                )}
              </div>

              <div className="todo-add-row">
                <input
                  className="text-in"
                  value={taskDraft}
                  onChange={(e) => setTaskDraft(e.target.value)}
                  placeholder="Add a task…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addTask();
                  }}
                />
                <button
                  className="primary-btn"
                  type="button"
                  disabled={busy || !taskDraft.trim()}
                  onClick={() => void addTask()}
                >
                  {taskPending?.kind === "add" ? "Adding…" : "Add"}
                </button>
              </div>

              {error ? (
                <p className="auth-error auth-error--gap" role="alert">
                  {error}
                </p>
              ) : null}
            </section>
          ) : null}
        </>
      ) : (
        <section className="panel" data-tour="tour-todos-tabs">
          <div data-tour="tour-todos-tasks">
            <EmptyState title="No Lists Yet" sub="Use the + button to create one." />
          </div>
        </section>
      )}

      {editor
        ? createPortal(
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
                  void submitEditor();
                }}
              >
                <div className="modal-head">
                  <h3>{editorTitle}</h3>
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={dismiss}
                    aria-label="Close"
                    disabled={savingList || deletingList}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
                <div className="modal-body modal-scroll">
                  <div className="dm-sec">
                    <label className="fld-label" htmlFor="todo-list-name">
                      List name
                    </label>
                    <input
                      id="todo-list-name"
                      className="text-in wallet-field"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                      placeholder="e.g. Groceries, Work, Weekend"
                    />

                    <label className="fld-label">Icon</label>
                    <div className="cat-glyph-row">
                      {ICONS.map((g) => (
                        <button
                          key={g}
                          type="button"
                          className={"cat-glyph-btn" + (icon === g ? " active" : "")}
                          onClick={() => setIcon(g)}
                        >
                          {g}
                        </button>
                      ))}
                    </div>

                    {editorError ? (
                      <p className="auth-error auth-error--gap" role="alert">
                        {editorError}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="modal-foot">
                  {editor.type === "edit-list" ? (
                    <button
                      className="ghost-btn danger"
                      type="button"
                      disabled={savingList || deletingList}
                      onClick={() => setConfirmDelete({ type: "list", id: editor.listId })}
                    >
                      {deletingList ? "Deleting…" : "Delete"}
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="mf-right">
                    <button
                      className="ghost-btn"
                      type="button"
                      onClick={dismiss}
                      disabled={savingList || deletingList}
                    >
                      Cancel
                    </button>
                    <button
                      className="primary-btn"
                      type="submit"
                      disabled={savingList || deletingList || !name.trim()}
                    >
                      {savingList
                        ? "Saving…"
                        : editor.type === "add-list"
                          ? "Add List"
                          : "Save Changes"}
                    </button>
                  </div>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}

      {confirmDelete?.type === "list" ? (
        <ConfirmDialog
          title="Delete List"
          message={
            deleteTarget?.tasks.length
              ? `Delete "${deleteTarget.name}" and ${deleteTarget.tasks.length === 1 ? "its 1 task" : `all ${deleteTarget.tasks.length} of its tasks`}? This cannot be undone.`
              : `Delete "${deleteTarget?.name ?? ""}"? This cannot be undone.`
          }
          requireText={deleteTarget?.tasks.length ? deleteTarget.name.trim() : undefined}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await removeList(confirmDelete.id);
            setConfirmDelete(null);
          }}
        />
      ) : null}
      {confirmDelete?.type === "task" ? (
        <ConfirmDialog
          title="Remove Task"
          message={`Remove "${deleteTarget?.tasks.find((t) => t.id === confirmDelete.taskId)?.title ?? ""}"? This cannot be undone.`}
          confirmLabel="Remove"
          pendingLabel="Removing…"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await removeTask(confirmDelete.listId, confirmDelete.taskId);
            setConfirmDelete(null);
          }}
        />
      ) : null}
    </div>
  );
});
