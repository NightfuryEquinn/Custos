import { Root } from "@/frontend/app/Root";
import logoUrl from "@/frontend/assets/logo.png";
import { applyTheme, getStoredTheme, resolveDark } from "@/frontend/lib/theme";
import { registerServiceWorker } from "@/frontend/lib/pwa/register";
import "@/frontend/styles/fonts.css";
import "@/frontend/styles/ledger.css";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/frontend/lib/api";
import { retryAfterFromError } from "@/frontend/lib/category-transfer";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

applyTheme(resolveDark(getStoredTheme()));
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

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    /* Every production failure was previously invisible — this is the only
       place any query error surfaces before a screen swallows it. */
    onError: (err, query) => {
      const status = err instanceof ApiError ? err.status : undefined;
      console.error(`[query:${query.queryHash}]`, status ?? "network", err.message);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      /* A 401 or a client-side crypto error (bad key, malformed payload)
         will never succeed on retry — don't burn the one retry on those. */
      retry: (failureCount, err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return false;
        return failureCount < 1;
      },
      /* Honor the server's Retry-After on 429 instead of retrying instantly
         into a still-closed rate-limit window. */
      retryDelay: (_attempt, err) => retryAfterFromError(err) ?? 0,
      /* staleTime already covers casual refocus; the previous default of
         `true` refired every ledger query (incl. pagination loops) on every
         tab focus past 30s, which is a large chunk of the intermittent 429s. */
      refetchOnWindowFocus: false,
    },
  },
});

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
