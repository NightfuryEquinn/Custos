import { beforeEach, expect, test } from "bun:test";
import { hasDailyCache, offlinePrep } from "@/frontend/lib/pwa/readiness";
import { cachedPathsForAddress, putCipherCache } from "@/frontend/lib/pwa/cipher-cache";
import { resetFakeIdb } from "../helpers/fake-idb";

const paths = [
  "/profile",
  "/wallets",
  "/categories",
  "/expenses?from=2023-10-01&limit=2000",
  "/todo-lists",
  "/capital-plans",
  "/vehicles",
  "/vehicles/fills?limit=2000",
  "/events?month=2026-10&limit=2000",
  "/daily/routines",
  "/daily/completions",
  "/nudges",
  "/users/me",
];
beforeEach(resetFakeIdb);
test("offline prep follows the record cache, then a controlling worker's shell", () => {
  expect(offlinePrep(true, true, "none")).toBe("ready");
  expect(offlinePrep(true, true, "ready")).toBe("ready");
  expect(offlinePrep(true, true, "missing")).toBe("shell");
  expect(offlinePrep(false, true, "none")).toBe("records");
  expect(offlinePrep(true, false, "ready")).toBe("records");
});
test("readiness requires the selected month's events and every daily resource", () => {
  expect(hasDailyCache(paths, "2026-10")).toBe(true);
  expect(hasDailyCache(paths, "2026-11")).toBe(false);
  for (const path of paths)
    expect(
      hasDailyCache(
        paths.filter((item) => item !== path),
        "2026-10",
      ),
    ).toBe(false);
});
test("cache readiness is scoped to an account and excludes expired data", async () => {
  await putCipherCache("0xAAA", "/wallets", { wallets: [] });
  expect(await cachedPathsForAddress("0xaaa")).toEqual(["/wallets"]);
  expect(await cachedPathsForAddress("0xbbb")).toEqual([]);
  const original = Date.now;
  Date.now = () => original() + 31 * 24 * 60 * 60 * 1000;
  try {
    expect(await cachedPathsForAddress("0xaaa")).toEqual([]);
  } finally {
    Date.now = original;
  }
});
