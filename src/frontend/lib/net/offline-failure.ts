import { ApiError } from "@/frontend/lib/net/api-error";

/**
 * Whether `err` means the request never reached the server at all — a real
 * network failure, offline, a timed-out/aborted request, a rate limit, or a
 * server error. None of those mean the data (or the answer) changed, so
 * callers may fall back to a cached/local answer. A 401/403/404 means the
 * server *did* answer, and the answer was "no" — that must never be papered
 * over by a cache or a locally-trusted fallback.
 *
 * Shared by the API layer's cache fallback (`src/frontend/lib/api.ts`), the
 * app boot sequence (`src/frontend/app/Root.tsx`), and the offline write
 * queue, so there is exactly one definition of "this is a network problem,
 * not a real rejection" instead of several that could drift apart.
 */
export function isOfflineFailure(err: unknown): boolean {
  const status = err instanceof ApiError ? err.status : undefined;
  const isAbort = err instanceof DOMException && err.name === "AbortError";

  return (
    err instanceof TypeError ||
    isAbort ||
    !navigator.onLine ||
    status === 429 ||
    (!!status && status >= 500)
  );
}
