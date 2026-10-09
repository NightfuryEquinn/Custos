import { Icon } from "@/frontend/components/ui";
import { useModalMotion } from "@/frontend/lib/animate";
import { toast } from "@/frontend/lib/feedback";
import {
  NAV_GROUPS,
  NAV_ITEM_BY_ID,
  NAV_ITEMS,
  resolveNav,
  type NavItem,
} from "@/frontend/lib/nav";
import type { ViewId } from "@/frontend/lib/types";
import { DEFAULT_TAB_IDS, TAB_SLOTS } from "@/lib/views";
import { resolveStartView } from "@/frontend/lib/journal-navigation";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

type NavigationModalProps = {
  /** Current sidebar order, resolved (all views, defaults already applied). */
  sidebarItems: readonly NavItem[];
  /** Current favorites (bottom bar, top of the sidebar), in order. */
  tabItems: readonly NavItem[];
  /** Saved start page; undefined until the account chooses one. */
  startView?: ViewId;
  onSave: (prefs: {
    navOrder: ViewId[];
    navTabs: ViewId[];
    startView?: ViewId;
  }) => Promise<unknown>;
  onClose: () => void;
};

/** Swap two ids in the flat order, so a move never crosses a group. */
function swap(list: ViewId[], a: ViewId, b: ViewId): ViewId[] {
  const next = [...list];
  const i = next.indexOf(a);
  const j = next.indexOf(b);
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Choose the start page, four favorites, and the order within each group. */
export function NavigationModal({
  sidebarItems,
  tabItems,
  startView,
  onSave,
  onClose,
}: NavigationModalProps) {
  const [order, setOrder] = useState<ViewId[]>(() => sidebarItems.map(([id]) => id));
  const [tabs, setTabs] = useState<ViewId[]>(() => tabItems.map(([id]) => id));
  /* Show where Custos really opens: accounts that never chose land on their first favorite on
     phones and on Home elsewhere, so that is what is selected until they pick something. */
  const [start, setStart] = useState<ViewId>(
    () =>
      resolveStartView(
        "",
        startView,
        tabItems[0]![0],
        window.matchMedia("(max-width: 639px)").matches,
      ) ?? "overview",
  );
  /* Only a deliberate pick is saved, so accounts that never chose keep the older landing rule. */
  const [startTouched, setStartTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  const fields = JSON.stringify([order, tabs, startTouched && start]);
  const [baseline] = useState(fields);
  const { requestClose, dismiss } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    onDismiss: busy ? false : onClose,
    dirty: fields !== baseline,
  });

  const toggleTab = (id: ViewId) => {
    setTabs((prev) => {
      if (prev.includes(id)) return prev.filter((t) => t !== id);
      if (prev.length >= TAB_SLOTS) return prev;
      return [...prev, id];
    });
  };

  const resetDefaults = () => {
    setOrder(resolveNav().sidebarItems.map(([id]) => id));
    setTabs([...DEFAULT_TAB_IDS]);
    setError("");
  };

  const canSave = tabs.length === TAB_SLOTS;

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave({
        navOrder: order,
        navTabs: tabs,
        ...(startTouched ? { startView: start } : {}),
      });
      toast("Navigation saved");
      requestClose(onClose);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
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
        className="modal sm modal--medium"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nav-modal-title"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="modal-head">
          <h3 id="nav-modal-title">Navigation</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={dismiss}
            aria-label="Close"
            disabled={busy}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="modal-body modal-scroll">
          <div className="dm-sec">
            <span className="fld-label" id="nav-start-label">
              Start page
            </span>
            <div className="sub-row" role="radiogroup" aria-labelledby="nav-start-label">
              {sidebarItems.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={start === id}
                  className={"sub-chip" + (start === id ? " active" : "")}
                  onClick={() => {
                    setStart(id);
                    setStartTouched(true);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="dm-div" />

          <div className="dm-sec">
            <span className="fld-label">Favorites</span>
            <p className="dm-lead">Four pages for the bottom bar and the top of the sidebar.</p>
            <div className="nav-tab-preview">
              {tabs.map((id) => (
                <span key={id} className="nav-tab-preview-item">
                  <Icon name={NAV_ITEM_BY_ID.get(id)![2]} size={16} />
                  {NAV_ITEM_BY_ID.get(id)![1]}
                </span>
              ))}
              {Array.from({ length: TAB_SLOTS - tabs.length }).map((_, i) => (
                <span key={`empty-${i}`} className="nav-tab-preview-item nav-tab-preview-empty">
                  {tabs.length + i + 1}
                </span>
              ))}
              <span className="nav-tab-preview-item nav-tab-preview-more">
                <Icon name="more" size={16} />
                More
              </span>
            </div>
            <div className="sub-row">
              {NAV_ITEMS.map(([id, label]) => {
                const picked = tabs.indexOf(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={"sub-chip" + (picked >= 0 ? " active" : "")}
                    disabled={picked < 0 && tabs.length >= TAB_SLOTS}
                    onClick={() => toggleTab(id)}
                  >
                    {picked >= 0 ? `${picked + 1}. ` : ""}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="dm-div" />

          <div className="dm-sec">
            <span className="fld-label">Order within each group</span>
            {NAV_GROUPS.map(([groupLabel, groupIds]) => {
              const ids = order.filter((id) => groupIds.includes(id));
              return (
                <div key={groupLabel}>
                  <span className="journal-eyebrow">{groupLabel}</span>
                  <ul className="nav-order-list">
                    {ids.map((id, i) => {
                      const [, label, icon] = NAV_ITEM_BY_ID.get(id)!;
                      return (
                        <li key={id} className="nav-order-row">
                          <Icon name={icon} size={18} />
                          <span className="nav-order-label">{label}</span>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Move ${label} up`}
                            disabled={i === 0}
                            onClick={() => setOrder((prev) => swap(prev, id, ids[i - 1]!))}
                          >
                            <Icon name="chevU" size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Move ${label} down`}
                            disabled={i === ids.length - 1}
                            onClick={() => setOrder((prev) => swap(prev, id, ids[i + 1]!))}
                          >
                            <Icon name="chevD" size={16} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>

          {!canSave ? (
            <p className="fld-hint">
              Pick {TAB_SLOTS} favorites to save ({tabs.length} selected).
            </p>
          ) : null}
          {error ? (
            <p className="auth-error auth-error--gap" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="modal-foot">
          <button className="ghost-btn" type="button" disabled={busy} onClick={resetDefaults}>
            Reset to Defaults
          </button>
          <div className="mf-right">
            <button className="ghost-btn" type="button" disabled={busy} onClick={dismiss}>
              Cancel
            </button>
            <button className="primary-btn" type="submit" disabled={busy || !canSave}>
              {busy ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}
