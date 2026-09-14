/**
 * Thrown by `request()` in `src/frontend/lib/api.ts` for any non-2xx
 * response. Lives in its own module (rather than in `api.ts`) so
 * `offline-failure.ts` can depend on it without a circular import back into
 * `api.ts`, which itself depends on `offline-failure.ts`'s cache-fallback
 * predicate.
 */
export class ApiError extends Error {
  status: number;
  retryAfterMs?: number;

  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
