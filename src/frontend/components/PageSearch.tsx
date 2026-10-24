import { Icon } from "@/frontend/components/ui";
import { useModalMotion } from "@/frontend/lib/animate";
import { useSearchData } from "@/frontend/lib/search/useSearchData";
import type { SearchHistory, SearchLedger } from "@/frontend/lib/search/documents";
import type { SearchTarget } from "@/frontend/lib/search/model";
import { useNetworkStatus } from "@/frontend/lib/hooks/useNetworkStatus";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type SearchProps = {
  address: string;
  ledger: SearchLedger;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSelect: (target: SearchTarget, history: SearchHistory) => void;
};

type SearchGroupOption = { id: string; label: string };

/** Custom dropdown for the search result type. */
function SearchGroupPicker({
  options,
  value,
  onChange,
}: {
  options: readonly SearchGroupOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "picker", active: open });
  const selected = options.find((option) => option.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    activeRef.current?.scrollIntoView({ block: "nearest" });

    /** Close the menu without also dismissing the search dialog behind it. */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!selected) return null;

  const menu = open ? (
    <div
      ref={scrimRef}
      className="picker-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose(() => setOpen(false));
      }}
    >
      <div
        ref={panelRef}
        className="picker-menu picker-menu--lead"
        role="listbox"
        aria-label="Result type"
      >
        <div className="picker-timezone-list">
          {options.map((option) => {
            const active = option.id === selected.id;

            return (
              <button
                key={option.id || "everything"}
                ref={active ? activeRef : undefined}
                type="button"
                role="option"
                aria-selected={active}
                className={"picker-timezone-item" + (active ? " active" : "")}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
              >
                <span className="pti-label">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="picker-wrap search-group-picker" ref={rootRef}>
      <button
        type="button"
        className="picker-trigger"
        aria-label="Result type"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="picker-trigger-label">{selected.label}</span>
        <Icon name="chevD" size={16} />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

/** Keep the shortcut available while unmounting private search state when closed. */
export function PageSearch(props: SearchProps) {
  const { open, setOpen } = props;
  useEffect(() => {
    /** Leave other editors' keyboard shortcuts and unsaved changes alone. */
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      if (document.querySelector('[aria-modal="true"]') && !open) return;
      event.preventDefault();
      setOpen(!open);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open, setOpen]);
  return open ? <SearchDialog key={props.address} {...props} /> : null;
}

/** Search account content locally, keeping download coverage distinct from match count. */
function SearchDialog({ address, ledger, setOpen, onSelect }: SearchProps) {
  const { data, documents, loading, unavailable, retry } = useSearchData(address, ledger);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(40);
  const [searching, setSearching] = useState(true);
  const [workerError, setWorkerError] = useState(false);
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  const indexed = useRef<typeof documents | null>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { isOffline } = useNetworkStatus();
  const { dismiss, requestClose } = useModalMotion(scrim, panel, {
    variant: "sheet",
    onDismiss: () => setOpen(false),
  });
  useEffect(() => {
    let instance: Worker;
    try {
      instance = new Worker("/search-worker.js", { type: "module" });
    } catch {
      setWorkerError(true);
      setSearching(false);
      return;
    }
    worker.current = instance;
    instance.onmessage = (event: MessageEvent<{ sequence: number; keys: string[] }>) => {
      if (event.data.sequence !== sequence.current) return;
      setKeys(event.data.keys);
      setSearching(false);
    };
    instance.onerror = () => {
      setWorkerError(true);
      setSearching(false);
    };
    return () => {
      instance.terminate();
      worker.current = null;
      indexed.current = null;
    };
  }, []);
  useEffect(() => {
    if (!worker.current) return;
    const next = ++sequence.current;
    setSearching(true);
    worker.current.postMessage({
      documents: indexed.current === documents ? undefined : documents,
      query,
      group,
      sequence: next,
    });
    indexed.current = documents;
  }, [documents, query, group]);
  const byKey = useMemo(
    () => new Map(documents.map((document) => [document.key, document])),
    [documents],
  );
  const groupOptions = useMemo(() => {
    const labels = [...new Set(documents.map((row) => row.group))];

    return [{ id: "", label: "Everything" }, ...labels.map((label) => ({ id: label, label }))];
  }, [documents]);
  const ranked = keys.map((key) => byKey.get(key)).filter((row) => row !== undefined);
  const resultGroups = new Map<string, typeof ranked>();
  for (const row of ranked) {
    const rows = resultGroups.get(row.group) ?? [];
    rows.push(row);
    resultGroups.set(row.group, rows);
  }
  const matches = [...resultGroups.values()].flat();
  const visible = matches.slice(0, limit);
  const selected = Math.min(active, Math.max(0, visible.length - 1));
  useEffect(() => {
    panel.current
      ?.querySelector(`[data-result-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  /** Release this dialog's focus and scroll ownership before opening the selected editor. */
  const go = (index: number) => {
    const document = visible[index];
    if (!document || searching || workerError) return;
    requestClose(() => {
      setOpen(false);
      onSelect(document.target, data);
    });
  };
  return createPortal(
    <div
      ref={scrim}
      className="modal-scrim journal-command-scrim global-search-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        ref={panel}
        className="modal journal-command global-search"
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-search-title"
      >
        <div className="modal-head">
          <h2 id="global-search-title">Search Custos</h2>
          <button type="button" className="icon-btn" aria-label="Close search" onClick={dismiss}>
            <Icon name="close" />
          </button>
        </div>
        <div className="global-search-controls">
          <div className="journal-search">
            <Icon name="search" />
            <input
              autoFocus
              role="combobox"
              aria-label="Search Custos"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="global-search-results"
              aria-activedescendant={visible[selected] ? `search-result-${selected}` : undefined}
              placeholder="Search anything…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
                setLimit(40);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive(
                    Math.max(
                      0,
                      Math.min(visible.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1)),
                    ),
                  );
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  go(selected);
                }
              }}
            />
          </div>
          <SearchGroupPicker
            options={groupOptions}
            value={group}
            onChange={(next) => {
              setGroup(next);
              setActive(0);
              setLimit(40);
            }}
          />
        </div>
        <p className="global-search-status" role="status" aria-live="polite">
          {workerError
            ? "Search could not start. Close and reopen to retry."
            : searching
              ? "Searching…"
              : `${matches.length} ${matches.length === 1 ? "result" : "results"}`}
          {loading
            ? " · Loading history…"
            : isOffline
              ? " · Downloaded records only"
              : unavailable.length
                ? " · Some history unavailable"
                : " · All wallets and dates"}
        </p>
        {!loading && unavailable.length > 0 && (
          <div className="global-search-status">
            Unavailable: {unavailable.join(", ")}.{" "}
            <button className="text-btn" onClick={retry}>
              Retry
            </button>
          </div>
        )}
        <div
          className="modal-body global-search-results"
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          aria-busy={searching}
        >
          {visible.map((row, index) => (
            <div key={row.key} role="presentation">
              {(index === 0 || visible[index - 1]?.group !== row.group) && (
                <p className="global-search-group" aria-hidden="true">
                  {row.group}
                </p>
              )}
              <button
                type="button"
                role="option"
                id={`search-result-${index}`}
                data-result-index={index}
                aria-selected={index === selected}
                className="global-search-result"
                onClick={() => go(index)}
              >
                <span>
                  <strong>{row.title}</strong>
                  <small>{row.context}</small>
                </span>
                <Icon name="chevR" size={16} />
              </button>
            </div>
          ))}
          {!visible.length && !searching && !workerError && (
            <p className="global-search-empty">
              {loading || unavailable.length || isOffline
                ? "No matches in available records."
                : "No matches. Try another word or date."}
            </p>
          )}
        </div>
        {matches.length > limit && (
          <div className="modal-foot">
            <button className="ghost-btn" onClick={() => setLimit((value) => value + 40)}>
              Show more results
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
