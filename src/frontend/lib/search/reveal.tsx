import { createContext, useContext, useEffect, useRef } from "react";
import { toast } from "@/frontend/lib/feedback";
import type { SearchKind, SearchTarget } from "./model";

export const SearchRevealContext = createContext<{
  target: SearchTarget | null;
  handled: () => void;
}>({ target: null, handled: () => {} });

/** Consume a destination once its lazy view has mounted and can open the existing UI. */
export function useSearchReveal(kinds: SearchKind[], reveal: (target: SearchTarget) => boolean) {
  const { target, handled } = useContext(SearchRevealContext);
  const last = useRef<SearchTarget | null>(null);
  useEffect(() => {
    if (!target || last.current === target || !kinds.includes(target.kind)) return;
    last.current = target;
    if (!reveal(target)) toast("This record is no longer available. Search again to refresh.");
    handled();
  }, [target, handled, kinds, reveal]);
}

/** Reveal an inline record after its parent selection has rendered, without activating it. */
export function focusSearchRecord(id: string) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-search-id="${CSS.escape(id)}"]`);
      if (!element) return;
      element.scrollIntoView({ block: "center", behavior: "instant" });
      if (!element.matches("button, input, select, textarea, a[href], [tabindex]"))
        element.tabIndex = -1;
      element.focus({ preventScroll: true });
    }),
  );
}
