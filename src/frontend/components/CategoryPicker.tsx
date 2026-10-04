import { useModalMotion } from "@/frontend/lib/animate";
import type { Category } from "@/frontend/lib/types";
import { displayGlyph } from "@/lib/glyphs";
import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function ChevDown({ size = 16 }: { size?: number }) {
  return <CaretDown size={size} aria-hidden />;
}

type CategoryPickerProps = {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
};

/** Custom dropdown for picking an expense category (event modal hold field). */
export function CategoryPicker({
  categories,
  value,
  onChange,
  className,
  disabled,
  id,
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, {
    variant: "picker",
    active: open && !disabled,
  });
  const selected = categories.find((c) => c.id === value) ?? categories[0];

  useEffect(() => {
    if (!selected || selected.id === value) return;
    onChange(selected.id);
  }, [selected, value, onChange]);

  useEffect(() => {
    if (!open) return;
    activeRef.current?.scrollIntoView({ block: "nearest" });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const choose = (catId: string) => {
    onChange(catId);
    setOpen(false);
  };

  if (!selected) return null;

  const menu =
    open && !disabled ? (
      <div
        ref={scrimRef}
        className="picker-scrim"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) requestClose(() => setOpen(false));
        }}
      >
        <div
          ref={panelRef}
          className="picker-menu picker-menu--category"
          role="listbox"
          aria-label="Category"
        >
          <div className="picker-category-list">
            {categories.map((c) => {
              const active = c.id === selected.id;
              return (
                <button
                  key={c.id}
                  ref={active ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={"picker-category-item" + (active ? " active" : "")}
                  onClick={() => choose(c.id)}
                >
                  <span className="pci-glyph" style={{ color: c.color }}>
                    {displayGlyph(c.glyph, c.id)}
                  </span>
                  <span className="pci-label">{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div className={"picker-wrap" + (className ? ` ${className}` : "")} ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="picker-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="picker-trigger-label">
          <span className="picker-cat-glyph" style={{ color: selected.color }}>
            {displayGlyph(selected.glyph, selected.id)}
          </span>
          <span>{selected.name}</span>
        </span>
        <ChevDown />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
