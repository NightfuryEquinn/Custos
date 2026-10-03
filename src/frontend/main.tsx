import { Root } from "@/frontend/app/Root";
import logoUrl from "@/frontend/assets/logo.png";
import {
  applyAccent,
  applySurface,
  applyTheme,
  getStoredAccent,
  getStoredSurface,
  getStoredTheme,
  resolveDark,
} from "@/frontend/lib/theme";
import { registerServiceWorker } from "@/frontend/lib/pwa/register";
import "@/frontend/styles/fonts.css";
import "@/frontend/styles/app.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { createLedgerQueryClient } from "@/frontend/lib/query-client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

applyTheme(resolveDark(getStoredTheme()));
applyAccent(getStoredAccent());
applySurface(getStoredSurface());
registerServiceWorker();

/** Attach the web app manifest without involving the HTML bundler. */
const manifestLink =
  document.querySelector<HTMLLinkElement>("link[rel='manifest']") ??
  Object.assign(document.createElement("link"), { rel: "manifest" });
manifestLink.href = "/manifest.webmanifest";
document.head.appendChild(manifestLink);

const favicon =
  document.querySelector<HTMLLinkElement>("link[rel='icon']") ??
  Object.assign(document.createElement("link"), { rel: "icon" });
favicon.href = logoUrl;
document.head.appendChild(favicon);

const queryClient = createLedgerQueryClient();

const elem = document.getElementById("root")!;

const tree = (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
      <Analytics />
      <SpeedInsights />
    </QueryClientProvider>
  </StrictMode>
);

if (import.meta.hot) {
  const hotData = import.meta.hot.data as { root?: ReturnType<typeof createRoot> };
  if (!hotData.root) hotData.root = createRoot(elem);
  hotData.root.render(tree);
} else {
  createRoot(elem).render(tree);
}
