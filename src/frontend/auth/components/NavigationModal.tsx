import { Icon } from "@/frontend/components/ui";
import { useModalMotion } from "@/frontend/lib/animate";
import { NAV_ITEM_BY_ID, NAV_ITEMS, type NavItem } from "@/frontend/lib/nav";
import type { ViewId } from "@/frontend/lib/types";
import { DEFAULT_TAB_IDS, TAB_SLOTS, VIEW_IDS } from "@/lib/views";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

type NavigationModalProps = {
  /** Current sidebar order, resolved (all views, defaults already applied). */
  sidebarItems: readonly NavItem[];
  /** Current mobile tab-bar picks, in order. */
  tabItems: readonly NavItem[];
  onSave: (prefs: { navOrder: ViewId[]; navTabs: ViewId[] }) => Promise<unknown>;
  onClose: () => void;
};

/** Move an array element by ±1, no-op past either end. */
function move<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** Customize the mobile tab bar (pick four, in order) and the sidebar order. */
export function NavigationModal({ sidebarItems, tabItems, onSave, onClose }: NavigationModalProps) {
  const [order, setOrder] = useState<ViewId[]>(() => sidebarItems.map(([id]) => id));
  const [tabs, setTabs] = useState<ViewId[]>(() => tabItems.map(([id]) => id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });

  const toggleTab = (id: ViewId) => {
    setTabs((prev) => {
      if (prev.includes(id)) return prev.filter((t) => t !== id);
      if (prev.length >= TAB_SLOTS) return prev;
      return [...prev, id];
    });
  };

  const resetDefaults = () => {
    setOrder([...VIEW_IDS]);
    setTabs([...DEFAULT_TAB_IDS]);
    setError("");
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave({ navOrder: order, navTabs: tabs });
      requestClose(onClose);
    } catch {
      setError("Could not save — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const canSave = tabs.length === TAB_SLOTS;

  return createPortal(
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) requestClose(onClose);
      }}
    >
      <div
        ref={panelRef}
        className="modal sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nav-modal-title"
      >
        <div className="modal-head">
          <h3 id="nav-modal-title">Navigation</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={() => requestClose(onClose)}
            aria-label="Close"
            disabled={busy}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="modal-body modal-scroll">
          <div className="dm-sec">
            <span className="fld-label">Mobile tab bar</span>
            <p className="dm-lead">
              Pick four, in the order they should appear. Everything else lives under More. On
              mobile, the app opens on the first one.
            </p>
            <div className="nav-tab-preview">
              {tabs.map((id) => (
                <span key={id} className="nav-tab-preview-item">
                  <Icon name={NAV_ITEM_BY_ID.get(id)![2]} size={16} />
                  {NAV_ITEM_BY_ID.get(id)![3] ?? NAV_ITEM_BY_ID.get(id)![1]}
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
            <span className="fld-label">Sidebar order</span>
            <p className="dm-lead">Tablet and desktop show every view in this order.</p>
            <ul className="nav-order-list">
              {order.map((id, i) => {
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
                      onClick={() => setOrder((prev) => move(prev, i, -1))}
                    >
                      <Icon name="chevU" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Move ${label} down`}
                      disabled={i === order.length - 1}
                      onClick={() => setOrder((prev) => move(prev, i, 1))}
                    >
                      <Icon name="chevD" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {error ? <p className="dm-note">{error}</p> : null}
        </div>

        <div className="modal-foot">
          <button className="ghost-btn" type="button" disabled={busy} onClick={resetDefaults}>
            Reset to Defaults
          </button>
          <button
            className="ghost-btn"
            type="button"
            disabled={busy}
            onClick={() => requestClose(onClose)}
          >
            Cancel
          </button>
          <button className="primary-btn" type="button" disabled={busy || !canSave} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
