import { VIEW_IDS, type ViewId } from "@/lib/views";
import { useCallback, useEffect, useState } from "react";

/** Resolve a URL hash to a known view, falling back to the overview. */
export function viewFromHash(hash: string): ViewId {
  const id = hash.replace(/^#\/?/, "");
  return VIEW_IDS.includes(id as ViewId) ? (id as ViewId) : "overview";
}

/** URL-backed destinations survive refresh and support browser Back/Forward. */
export function useJournalNavigation() {
  const [view, updateView] = useState<ViewId>(() => viewFromHash(window.location.hash));

  useEffect(() => {
    /** Sync the active view after browser history navigation. */
    const onHistory = () => updateView(viewFromHash(window.location.hash));

    window.addEventListener("popstate", onHistory);
    window.addEventListener("hashchange", onHistory);

    return () => {
      window.removeEventListener("popstate", onHistory);
      window.removeEventListener("hashchange", onHistory);
    };
  }, []);

  const setView = useCallback((id: ViewId) => {
    if (viewFromHash(window.location.hash) === id) return;
    window.history.pushState(null, "", `#${id}`);
    updateView(id);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".page-title")?.focus({ preventScroll: true });
      document.querySelector(".scroll")?.scrollTo(0, 0);
    });

    return () => cancelAnimationFrame(frame);
  }, [view]);

  return { view, setView };
}
