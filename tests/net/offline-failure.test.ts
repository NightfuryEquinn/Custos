import { beforeAll, describe, expect, test } from "bun:test";
import { isOfflineFailure, isPermanentFailure } from "@/frontend/lib/net/offline-failure";
import { ApiError } from "@/frontend/lib/net/api-error";

beforeAll(() => {
  // bun's test runtime has a bare `navigator` with no `onLine` — pin it "online"
  // so the predicate's own status/type checks are what's under test here.
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
});

describe("isOfflineFailure", () => {
  test("a real network failure is offline", () => {
    expect(isOfflineFailure(new TypeError("Failed to fetch"))).toBe(true);
  });

  test("an aborted/timed-out request is offline", () => {
    expect(isOfflineFailure(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  test("a rate limit or server error is treated as offline (cache-fallback eligible)", () => {
    expect(isOfflineFailure(new ApiError(429, "Too Many Requests"))).toBe(true);
    expect(isOfflineFailure(new ApiError(500, "Internal Server Error"))).toBe(true);
    expect(isOfflineFailure(new ApiError(503, "Service Unavailable"))).toBe(true);
  });

  test("navigator.onLine === false is offline regardless of error shape", () => {
    Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
    try {
      expect(isOfflineFailure(new ApiError(400, "Bad Request"))).toBe(true);
    } finally {
      Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
    }
  });

  test("a definite, server-answered rejection is never treated as offline", () => {
    expect(isOfflineFailure(new ApiError(401, "Unauthorized"))).toBe(false);
    expect(isOfflineFailure(new ApiError(403, "Forbidden"))).toBe(false);
    expect(isOfflineFailure(new ApiError(404, "Not Found"))).toBe(false);
  });
});

describe("isPermanentFailure", () => {
  test("4xx client errors are permanent", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(isPermanentFailure(new ApiError(status, "x"))).toBe(true);
    }
  });

  test("network failures and 5xx/429 are not permanent", () => {
    expect(isPermanentFailure(new TypeError("Failed to fetch"))).toBe(false);
    expect(isPermanentFailure(new ApiError(429, "x"))).toBe(false);
    expect(isPermanentFailure(new ApiError(500, "x"))).toBe(false);
  });
});
