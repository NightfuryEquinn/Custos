import { useModalMotion } from "@/frontend/lib/animate";
import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type OptionPickerProps = {
  options: ReadonlyArray<{ id: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the listbox. */
  label: string;
  className?: string;
  triggerLabel?: string;
};

/** Custom dropdown for a short list of labelled options. */
export function OptionPicker({
  options,
  value,
  onChange,
  label,
  className,
  triggerLabel,
}: OptionPickerProps) {
  const [open, setOpen] = useState(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "picker", active: open });
  const selected = options.find((option) => option.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    activeRef.current?.scrollIntoView({ block: "nearest" });

    /** Close the menu without also dismissing a dialog behind it. */
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
        aria-label={label}
      >
        <div className="picker-timezone-list">
          {options.map((option) => {
            const active = option.id === selected.id;

            return (
              <button
                key={option.id || option.label}
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
    <div className={"picker-wrap" + (className ? ` ${className}` : "")}>
      <button
        type="button"
        className="picker-trigger"
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="picker-trigger-label">{selected.label}</span>
        <CaretDown size={16} aria-hidden />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
