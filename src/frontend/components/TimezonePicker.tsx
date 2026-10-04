import { useModalMotion } from "@/frontend/lib/animate";
import { timezoneOptions, timezoneShortName } from "@/lib/timezone";
import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

function ChevDown({ size = 16 }: { size?: number }) {
  return <CaretDown size={size} aria-hidden />;
}

function timezoneCity(timeZone: string) {
  return timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
}

type TimezonePickerProps = {
  value: string;
  onChange: (tz: string) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
};

export function TimezonePicker({ value, onChange, className, disabled, id }: TimezonePickerProps) {
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
  const options = useMemo(() => timezoneOptions(value), [value]);
  const offset = timezoneShortName(value);
  const city = timezoneCity(value);

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

  const choose = (tz: string) => {
    onChange(tz);
    setOpen(false);
  };

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
          className="picker-menu picker-menu--timezone"
          role="listbox"
          aria-label="Timezone"
        >
          <div className="picker-timezone-list">
            {options.map((tz) => {
              const active = tz === value;
              return (
                <button
                  key={tz}
                  ref={active ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={"picker-timezone-item" + (active ? " active" : "")}
                  onClick={() => choose(tz)}
                >
                  <span className="pti-offset num">{timezoneShortName(tz)}</span>
                  <span className="pti-label">{timezoneCity(tz)}</span>
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
          <span className="picker-tz-offset num">{offset}</span>
          <span className="picker-tz-city">{city}</span>
        </span>
        <ChevDown />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
