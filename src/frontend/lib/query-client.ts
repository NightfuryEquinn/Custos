import { QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/frontend/lib/api";
import { retryAfterFromError } from "@/frontend/lib/category-transfer";

export function createLedgerQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      /* Every production failure was previously invisible — this is the only
       place any query error surfaces before a screen swallows it. */
      onError: (err, query) => {
        const status = err instanceof ApiError ? err.status : undefined;
        /* Only an API error's message is server text. Anything else may be a parse error that
           quotes the decrypted data it choked on, so log just its kind. */
        const detail = err instanceof ApiError ? err.message : err.name;
        console.error(`[query:${query.queryHash}]`, status ?? "network", detail);
      },
    }),
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: {
        networkMode: "always",
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
}
