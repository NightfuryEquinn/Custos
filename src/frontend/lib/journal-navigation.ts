import { VIEW_IDS, type ViewId } from "@/lib/views";
import { useCallback, useEffect, useState } from "react";

/** Resolve a URL hash to a known view, falling back to Home. */
export function viewFromHash(hash: string): ViewId {
  const id = hash.replace(/^#\/?/, "");
  return VIEW_IDS.includes(id as ViewId) ? (id as ViewId) : "overview";
}

/**
 * Page to open on first load, or null when the URL already names one � links
 * and Back/Forward always win. A saved start page applies on every width;
 * accounts that never chose one keep the older behavior (first favorite on
 * phones, Home elsewhere).
 */
export function resolveStartView(
  hash: string,
  startView: ViewId | undefined,
  firstFavorite: ViewId,
  isPhone: boolean,
): ViewId | null {
  if (hash.replace(/^#\/?/, "")) return null;
  return startView ?? (isPhone ? firstFavorite : "overview");
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

  const setView = useCallback((id: ViewId, replace = false) => {
    if (viewFromHash(window.location.hash) === id) return;
    window.history[replace ? "replaceState" : "pushState"](null, "", `#${id}`);
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
