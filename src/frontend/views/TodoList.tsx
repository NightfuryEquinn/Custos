import { useEnter, useModalMotion } from "@/frontend/lib/animate";
import { ConfirmDialog, EmptyState, Icon } from "@/frontend/components/ui";
import { slugId } from "@/frontend/lib/categories";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<
    { type: "list"; id: string } | { type: "task"; listId: string; taskId: string } | null
  >(null);
  const taskSaveRef = useRef(false);
  /* Same shape as taskSaveRef — `busy` state can't stop two clicks landing
     in the same task from both calling persistList before either's
     setBusy(true) commits. */
  const persistListRef = useRef(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    active: !!editor,
  });
  const closeEditor = () => requestClose(() => setEditor(null));

  useEffect(() => {
    setLists(todoLists);
    if (!activeId && todoLists.length) setActiveId(todoLists[0]?.id ?? null);
    if (activeId && !todoLists.some((l) => l.id === activeId)) {
      setActiveId(todoLists[0]?.id ?? null);
    }
  }, [todoLists, activeId]);

  const active = useMemo(() => lists.find((l) => l.id === activeId) ?? null, [lists, activeId]);

  const persistList = async (
    data: Partial<TodoList> & { id?: string; name?: string; icon?: string },
  ) => {
    if (persistListRef.current) return undefined;
    persistListRef.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await onSave(data);
      setLists((prev) => {
        if (data.id) return prev.map((l) => (l.id === saved.id ? saved : l));
        return [...prev, saved];
      });
      if (!data.id) setActiveId(saved.id);
      setEditor(null);
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save list");
      throw err;
    } finally {
      persistListRef.current = false;
      setBusy(false);
    }
  };

  const updateTasks = async (listId: string, tasks: TodoTask[]) => {
    if (taskSaveRef.current) return;

    taskSaveRef.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await onSave({ id: listId, tasks });
      setLists((prev) => prev.map((l) => (l.id === saved.id ? saved : l)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save task");
    } finally {
      taskSaveRef.current = false;
      setBusy(false);
    }
  };

  const openAddList = () => {
    setEditor({ type: "add-list" });
    setName("");
    setIcon("📋");
    setError("");
  };

  useImperativeHandle(ref, () => ({ openAdd: openAddList }));

  const openEditList = (list: TodoList) => {
    setEditor({ type: "edit-list", listId: list.id });
    setName(list.name);
    setIcon(list.icon);
    setError("");
  };

  const removeList = async (listId: string) => {
    setBusy(true);
    setError("");
    try {
      await onDelete(listId);
      setLists((prev) => prev.filter((l) => l.id !== listId));
      if (activeId === listId) {
        const next = lists.filter((l) => l.id !== listId);
        setActiveId(next[0]?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete list");
    } finally {
      setBusy(false);
    }
  };

  const submitEditor = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!editor) return;

    if (editor.type === "add-list") {
      await persistList({ name: name.trim(), icon });
      return;
    }

    await persistList({ id: editor.listId, name: name.trim(), icon });
  };

  const addTask = async () => {
    if (!active || !taskDraft.trim()) return;
    const task: TodoTask = {
      id: taskId(taskDraft, active.tasks),
      title: taskDraft.trim(),
      done: false,
    };
    setTaskDraft("");
    await updateTasks(active.id, [...active.tasks, task]);
  };

  const toggleTask = async (listId: string, taskId: string) => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    const tasks = list.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t));
    await updateTasks(listId, tasks);
  };

  const removeTask = async (listId: string, taskId: string) => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    await updateTasks(
      listId,
      list.tasks.filter((t) => t.id !== taskId),
    );
  };

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
                    aria-label={busy ? "Deleting…" : "Delete List"}
                    title={busy ? "Deleting…" : "Delete List"}
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
                          {busy ? "Removing…" : "Remove"}
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
                  {busy ? "Adding…" : "Add"}
                </button>
              </div>

              {error ? <p className="auth-error">{error}</p> : null}
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
          )
        : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={confirmDelete.type === "list" ? "Delete List" : "Remove Task"}
          message={
            confirmDelete.type === "list"
              ? (() => {
                  const list = lists.find((l) => l.id === confirmDelete.id);
                  return `Delete "${list?.name ?? ""}" and all ${list?.tasks.length ?? 0} of its tasks? This cannot be undone.`;
                })()
              : (() => {
                  const list = lists.find((l) => l.id === confirmDelete.listId);
                  const task = list?.tasks.find((t) => t.id === confirmDelete.taskId);
                  return `Remove "${task?.title ?? ""}"? This cannot be undone.`;
                })()
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            if (confirmDelete.type === "list") await removeList(confirmDelete.id);
            else await removeTask(confirmDelete.listId, confirmDelete.taskId);
            setConfirmDelete(null);
          }}
        />
      ) : null}
    </div>
  );
});
