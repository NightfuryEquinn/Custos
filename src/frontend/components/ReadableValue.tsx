import { createElement, useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";

type ReadableValueProps = ComponentPropsWithoutRef<"div"> & {
  as?: "div" | "span" | "p" | "strong";
};

/** Full precision on one line; only overflowing values become keyboard scroll stops. */
export function ReadableValue({
  as = "span",
  className = "",
  children,
  ...props
}: ReadableValueProps) {
  const ref = useRef<HTMLElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let active = true;
    const measure = () => {
      if (active) setScrollable(element.scrollWidth > element.clientWidth + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      active = false;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [children]);
  return createElement(
    as,
    {
      ...props,
      ref,
      className: `${className} readable-value`.trim(),
      tabIndex: scrollable ? 0 : undefined,
    },
    children,
  );
}
