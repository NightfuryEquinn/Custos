import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Hints live outside animated, clipping category containers. */
export function ActionHints() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const hint = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const find = (event: Event) =>
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(
            ".cat-block-actions button[aria-label], .cat-sub-actions button[aria-label]",
          )
        : null;
    const show = (event: Event) => setTarget(find(event));
    const hide = () => setTarget(null);
    const leave = (event: PointerEvent) => {
      const button = find(event);
      if (
        button &&
        (!(event.relatedTarget instanceof Node) || !button.contains(event.relatedTarget))
      )
        hide();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", show);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", show);
    document.addEventListener("focusout", hide);
    document.addEventListener("click", hide);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", show);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("click", hide);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);
  useLayoutEffect(() => {
    if (!target || !hint.current) return;
    const rect = target.getBoundingClientRect();
    const box = hint.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        8,
        Math.min(rect.left + rect.width / 2 - box.width / 2, window.innerWidth - box.width - 8),
      ),
      top:
        rect.bottom + box.height + 16 < window.innerHeight
          ? rect.bottom + 8
          : Math.max(8, rect.top - box.height - 8),
    });
    const previous = target.getAttribute("aria-describedby");
    target.setAttribute("aria-describedby", [previous, id].filter(Boolean).join(" "));
    return () => {
      if (previous) target.setAttribute("aria-describedby", previous);
      else target.removeAttribute("aria-describedby");
    };
  }, [target, id]);
  return target
    ? createPortal(
        <div ref={hint} id={id} role="tooltip" className="action-hint" style={position}>
          {target.getAttribute("aria-label")}
        </div>,
        document.body,
      )
    : null;
}
