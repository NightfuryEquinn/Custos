import { Icon } from "@/frontend/components/ui";
import { useModalMotion } from "@/frontend/lib/animate";
import type { NavItem } from "@/frontend/lib/nav";
import type { ViewId } from "@/lib/views";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Group = { label: string; items: readonly NavItem[] };

/** Links, not buttons: middle-click works and Back/Forward come from the hash. */
function PageLink({
  item,
  active,
  className,
  size,
}: {
  item: NavItem;
  active: boolean;
  className: string;
  size: number;
}) {
  const [id, name, icon] = item;

  return (
    <a
      href={`#${id}`}
      data-tour={`tour-nav-${id}`}
      className={className + (active ? " active" : "")}
      aria-current={active ? "page" : undefined}
    >
      <Icon name={icon} size={size} />
      <span>{name}</span>
    </a>
  );
}

/** Persistent desktop navigation: favorites first, then the remaining groups. */
export function SideNav({
  view,
  favorites,
  groups,
}: {
  view: ViewId;
  favorites: readonly NavItem[];
  groups: readonly Group[];
}) {
  return (
    <nav className="journal-nav" aria-label="Pages" data-tour="tour-nav">
      {[{ label: "Favorites", items: favorites }, ...groups].map((group) => (
        <div className="journal-nav-group" key={group.label}>
          <span className="journal-eyebrow">{group.label}</span>
          {group.items.map((item) => (
            <PageLink
              key={item[0]}
              item={item}
              active={view === item[0]}
              className="journal-nav-item"
              size={20}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Phone and tablet navigation: the four favorites plus a More sheet. */
export function BottomNav({
  view,
  favorites,
  moreGroups,
}: {
  view: ViewId;
  favorites: readonly NavItem[];
  moreGroups: readonly Group[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const moreActive = moreGroups.some((g) => g.items.some(([id]) => id === view));
  const { requestClose } = useModalMotion(scrimRef, panelRef, {
    variant: "sheet",
    active: moreOpen,
    onDismiss: () => setMoreOpen(false),
  });

  /** A navigation (link, Back/Forward) closes the sheet. */
  useEffect(() => {
    setMoreOpen(false);
  }, [view]);

  return (
    <>
      <nav className="bottom-nav" aria-label="Pages" data-tour="tour-nav">
        {favorites.map((item) => (
          <PageLink
            key={item[0]}
            item={item}
            active={view === item[0]}
            className="bn-item"
            size={21}
          />
        ))}
        <button
          type="button"
          data-tour="tour-nav-more"
          className={"bn-item" + (moreActive || moreOpen ? " active" : "")}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <Icon name="more" size={21} />
          <span>More</span>
        </button>
      </nav>
      {moreOpen &&
        createPortal(
          <div
            ref={scrimRef}
            className="modal-scrim nav-more-scrim"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) requestClose(() => setMoreOpen(false));
            }}
          >
            <div
              ref={panelRef}
              className="modal nav-more-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="nav-more-title"
            >
              <div className="nav-more-head">
                <h2 id="nav-more-title">More</h2>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Close"
                  onClick={() => requestClose(() => setMoreOpen(false))}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
              {moreGroups.map((group) => (
                <div className="nav-more-group" key={group.label}>
                  <span className="journal-eyebrow">{group.label}</span>
                  <div className="nav-more-grid">
                    {group.items.map((item) => (
                      <PageLink
                        key={item[0]}
                        item={item}
                        active={view === item[0]}
                        className="nav-more-item"
                        size={22}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
