import { Icon } from "@/frontend/components/ui";
import type { NavItem } from "@/frontend/lib/nav";
import { bindMegaMenu } from "@/lib/mega-menu";
import type { ViewId } from "@/lib/views";
import { List } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

type Group = { label: string; items: readonly NavItem[] };

function MenuGroup({ label, items, view }: Group & { view: ViewId }) {
  return (
    <section className="mega-menu-group">
      <h3>{label}</h3>
      <ul>
        {items.map(([id, name, icon]) => (
          <li key={id}>
            <a
              className="mega-menu-link"
              href={`#${id}`}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon name={icon} size={20} />
              <span>{name}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MegaMenu({
  view,
  favorites,
  groups,
  setView,
}: {
  view: ViewId;
  favorites: readonly NavItem[];
  groups: readonly Group[];
  setView: (view: ViewId) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const trigger = triggerRef.current;
    const dialog = dialogRef.current;
    if (!trigger || !dialog) return;

    return bindMegaMenu(trigger, dialog, (link) => setView(link.hash.slice(1) as ViewId));
  }, [setView]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="mega-menu-control"
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-controls="journal-menu"
        data-tour="tour-nav"
      >
        <List size={20} aria-hidden="true" />
        Menu
      </button>
      <dialog
        ref={dialogRef}
        className="mega-menu mega-menu--app"
        id="journal-menu"
        aria-labelledby="journal-menu-title"
      >
        <div className="mega-menu-shade" aria-hidden="true" />
        <div className="mega-menu-panel">
          <header className="mega-menu-head">
            <h2 id="journal-menu-title">Pages</h2>
            <button type="button" className="mega-menu-control" data-mega-close>
              <Icon name="close" size={18} />
              Close
            </button>
          </header>
          <nav className="mega-menu-body" aria-label="Pages">
            <div className="mega-menu-favorites">
              <MenuGroup label="Favorites" items={favorites} view={view} />
            </div>
            <div className="mega-menu-groups">
              {groups.map((group) => (
                <MenuGroup key={group.label} {...group} view={view} />
              ))}
            </div>
          </nav>
        </div>
      </dialog>
    </>
  );
}
