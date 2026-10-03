import { Icon } from "@/frontend/components/ui";
import { useModalMotion } from "@/frontend/lib/animate";
import { toast } from "@/frontend/lib/feedback";
import type { NavItem } from "@/frontend/lib/nav";
import type { TodoList, ViewId } from "@/frontend/lib/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type CaptureAction = { id: string; label: string; icon: string; run: () => void };

type Props = {
  view: ViewId;
  navigate: (id: ViewId) => void;
  items: readonly NavItem[];
  favorites: readonly NavItem[];
  actions: CaptureAction[];
  disabled: boolean;
  todoLists: readonly Pick<TodoList, "id" | "name" | "icon">[];
  onTask: (title: string, listId: string | null) => Promise<void>;
};

export function JournalCommands({
  view,
  navigate,
  items,
  favorites,
  actions,
  disabled,
  todoLists,
  onTask,
}: Props) {
  const [mode, setMode] = useState<"index" | "add" | "task" | null>(null);
  const [query, setQuery] = useState("");
  const [task, setTask] = useState("");
  const [listId, setListId] = useState<string | null>(null);
  const targetList = todoLists.find((l) => l.id === listId) ?? todoLists[0];
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const scrim = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  /* Escape, backdrop and X all route through dismiss(); the task sheet asks
     before throwing away a typed title, and everything locks while saving. */
  const { requestClose, dismiss } = useModalMotion(scrim, panel, {
    active: mode !== null,
    variant: "sheet",
    onDismiss: busy ? false : () => setMode(null),
    dirty: mode === "task" && task.trim() !== "",
  });

  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (document.querySelector('[aria-modal="true"]') && !panel.current) return;
        e.preventDefault();
        setQuery("");
        setMode((current) => (current ? null : "index"));
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const open = mode !== null;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const main = document.querySelector<HTMLElement>(".journal-app .main");
    const dock = document.querySelector<HTMLElement>(".journal-dock");
    if (main) main.inert = true;
    if (dock) dock.inert = true;
    /* On touch, focusing the search field would pop the keyboard over the index. */
    const touch = window.matchMedia("(pointer: coarse)").matches;
    (
      (touch
        ? panel.current?.querySelector<HTMLElement>(".journal-command-body button")
        : panel.current?.querySelector<HTMLElement>("input")) ??
      panel.current?.querySelector<HTMLElement>("button")
    )?.focus({ preventScroll: true });
    const keys = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const elements = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, [tabindex="0"]',
        ) ?? [],
      );
      const first = elements[0];
      const last = elements.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keys, true);
    return () => {
      if (main) main.inert = false;
      if (dock) dock.inert = false;
      document.removeEventListener("keydown", keys, true);
      previous?.focus({ preventScroll: true });
    };
  }, [open]);

  const pick = (run: () => void) =>
    requestClose(() => {
      setMode(null);
      run();
    });
  const matches = items.filter(
    ([, label]) =>
      label.toLowerCase().includes(query.toLowerCase()) ||
      (label === "Overview" && "journal home".includes(query.toLowerCase())),
  );

  return (
    <>
      <div className="journal-dock" data-tour="tour-launcher">
        <button
          className="journal-launcher"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open && mode === "index"}
          onClick={() => {
            setQuery("");
            setMode("index");
          }}
        >
          <Icon name="sparkle" size={20} /> Open Custos <kbd>⌘ / Ctrl K</kbd>
        </button>
        <button
          className="journal-add"
          type="button"
          data-tour="tour-fab"
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => {
            setError("");
            setMode("add");
          }}
        >
          <Icon name="plus" size={20} /> Add
        </button>
      </div>
      {open &&
        createPortal(
          <div
            ref={scrim}
            className="modal-scrim journal-command-scrim"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) dismiss();
            }}
          >
            <div
              ref={panel}
              className="modal journal-command"
              role="dialog"
              aria-modal="true"
              aria-labelledby="journal-command-title"
            >
              <div className="modal-head">
                <h2 id="journal-command-title">
                  {mode === "index"
                    ? "Where would you like to go?"
                    : mode === "task"
                      ? "One thing to do."
                      : "Make a little space."}
                </h2>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Close"
                  disabled={busy}
                  onClick={dismiss}
                >
                  <Icon name="close" />
                </button>
              </div>
              <div className="modal-body journal-command-body">
                {mode === "index" ? (
                  <>
                    <label className="journal-search">
                      <Icon name="search" />
                      <input
                        aria-label="Find a view"
                        placeholder="Money, plans, tasks…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    {!query && (
                      <>
                        <span className="journal-eyebrow">Your favorites</span>
                        <div className="journal-favorites">
                          {favorites.map(([id, label, icon]) => (
                            <button key={id} type="button" onClick={() => pick(() => navigate(id))}>
                              <Icon name={icon} />
                              {id === "overview" ? "Journal" : label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    <span className="journal-eyebrow">The index</span>
                    <div className="journal-index">
                      {matches.map(([id, label, icon], i) => (
                        <button
                          key={id}
                          type="button"
                          aria-current={view === id ? "page" : undefined}
                          onClick={() => pick(() => navigate(id))}
                        >
                          <span className="journal-index-number">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <Icon name={icon} />
                          <span>{id === "overview" ? "Journal" : label}</span>
                          <Icon name="chevR" size={16} />
                        </button>
                      ))}
                    </div>
                    {!matches.length && (
                      <p role="status">No matching destination. Try “Schedule” or “Budgets”.</p>
                    )}
                  </>
                ) : mode === "add" ? (
                  <div className="journal-capture-actions">
                    {actions.map((action) => (
                      <button key={action.id} type="button" onClick={() => pick(action.run)}>
                        <Icon name={action.icon} />
                        <span>{action.label}</span>
                        <Icon name="plus" size={16} />
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setMode("task");
                        setTask("");
                        setListId(todoLists[0]?.id ?? null);
                      }}
                    >
                      <Icon name="checklist" />
                      <span>Task</span>
                      <Icon name="plus" size={16} />
                    </button>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!task.trim() || busy) return;
                      setBusy(true);
                      setError("");
                      void onTask(task.trim(), targetList?.id ?? null)
                        .then(() => {
                          toast("Task added");
                          requestClose(() => setMode(null));
                        })
                        .catch((err: unknown) =>
                          setError(
                            err instanceof Error ? err.message : "Could not save. Try again.",
                          ),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    <label className="fld-label" htmlFor="journal-task">
                      Task title
                    </label>
                    <input
                      id="journal-task"
                      className="text-in"
                      value={task}
                      maxLength={200}
                      autoFocus
                      onChange={(e) => setTask(e.target.value)}
                    />
                    {todoLists.length > 1 ? (
                      <>
                        <span className="fld-label journal-task-list-label">List</span>
                        <div className="sub-row" role="radiogroup" aria-label="Task list">
                          {todoLists.map((list) => (
                            <button
                              key={list.id}
                              type="button"
                              role="radio"
                              aria-checked={targetList?.id === list.id}
                              className={"sub-chip" + (targetList?.id === list.id ? " active" : "")}
                              onClick={() => setListId(list.id)}
                            >
                              {list.icon} {list.name}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    <p className="journal-note">
                      {targetList
                        ? `Added to ${targetList.icon} ${targetList.name}. Available offline.`
                        : "Added to a new Everyday list. Available offline."}
                    </p>
                    {error && (
                      <p className="auth-error auth-error--gap" role="alert">
                        {error}
                      </p>
                    )}
                    <button className="primary-btn" type="submit" disabled={!task.trim() || busy}>
                      {busy ? "Saving…" : "Add Task"}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
