import { Icon } from "@/frontend/components/ui";
import { useModalMotion } from "@/frontend/lib/animate";
import type { NavItem } from "@/frontend/lib/nav";
import type { ViewId } from "@/lib/views";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Extra words that find a page, so old names (and group names) still work. */
const matchesQuery = ([id, label]: NavItem, group: string, query: string) =>
  `${label} ${id} ${group}`.toLowerCase().includes(query.trim().toLowerCase());

/** Ctrl/Cmd+K page search: a plain jump-to-page list, nothing else. */
export function PageSearch({
  view,
  navigate,
  groups,
  open,
  setOpen,
}: {
  view: ViewId;
  navigate: (id: ViewId) => void;
  groups: readonly { label: string; items: readonly NavItem[] }[];
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const scrim = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { requestClose, dismiss } = useModalMotion(scrim, panel, {
    active: open,
    variant: "sheet",
    onDismiss: () => setOpen(false),
  });

  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        /* Leave other dialogs alone; only this one may close itself. */
        if (document.querySelector('[aria-modal="true"]') && !panel.current) return;
        e.preventDefault();
        setQuery("");
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open, setOpen]);

  const matches = groups.flatMap((g) =>
    g.items.filter((item) => matchesQuery(item, g.label, query)),
  );
  const go = (id: ViewId) =>
    requestClose(() => {
      setOpen(false);
      navigate(id);
    });

  if (!open) return null;
  return createPortal(
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
        aria-labelledby="page-search-title"
      >
        <div className="modal-head">
          <h2 id="page-search-title">Search pages</h2>
          <button className="icon-btn" type="button" aria-label="Close" onClick={dismiss}>
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body journal-command-body">
          <form
            className="journal-search"
            onSubmit={(e) => {
              e.preventDefault();
              if (matches[0]) go(matches[0][0]);
            }}
          >
            <Icon name="search" />
            <input
              aria-label="Search pages"
              placeholder="Transactions, Daily, Savings…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>
          <div className="journal-index">
            {matches.map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                aria-current={view === id ? "page" : undefined}
                onClick={() => go(id)}
              >
                <Icon name={icon} />
                <span>{label}</span>
                <Icon name="chevR" size={16} />
              </button>
            ))}
          </div>
          {!matches.length && <p role="status">No matching page.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
