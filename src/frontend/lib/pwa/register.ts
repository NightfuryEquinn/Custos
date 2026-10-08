/**
 * Register the service worker and hint that the app is installable.
 */

/**
 * Link the web app manifest at runtime.
 * It cannot live in index.html: Bun's HTML bundler tries to resolve the href at
 * build time, and the manifest is a `public/` asset copied verbatim instead.
 * Without the tag no browser discovers it — and iOS only allows Web Push for an
 * installed PWA, which needs a manifest.
 */
function linkManifest(): void {
  if (document.querySelector('link[rel="manifest"]')) return;

  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = "/manifest.webmanifest";
  document.head.appendChild(link);
}

/** True for the production client bundle, never for the hot-reload dev server. */
function isProductionBuild(): boolean {
  if (import.meta.hot) return false;

  try {
    return process.env.NODE_ENV === "production";
  } catch {
    return false;
  }
}

/** Register `/sw.js` when the browser supports service workers. */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  linkManifest();
  /* A cached shell must not answer dev reloads. */
  if (!isProductionBuild()) return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW registration is optional on free hosting / preview deploys. */
    });
  });
}
