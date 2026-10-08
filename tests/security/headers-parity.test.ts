import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VERCEL_HTML_HEADERS } from "@/lib/security-headers";

describe("security headers parity", () => {
  test("vercel.json HTML headers match the shared security-headers module", () => {
    const vercelPath = join(import.meta.dir, "..", "..", "vercel.json");
    const vercel = JSON.parse(readFileSync(vercelPath, "utf8")) as {
      headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };

    const appHeaders = vercel.headers?.find((h) => h.source === "/(.*)")?.headers ?? [];
    const expected = Object.fromEntries(VERCEL_HTML_HEADERS.map((h) => [h.key, h.value]));
    const actual = Object.fromEntries(appHeaders.map((h) => [h.key, h.value]));

    expect(actual).toEqual(expected);
  });

  test("the app rewrite leaves Vercel Speed Insights routes alone", () => {
    const vercelPath = join(import.meta.dir, "..", "..", "vercel.json");
    const vercel = JSON.parse(readFileSync(vercelPath, "utf8")) as {
      rewrites?: Array<{ source: string; destination: string }>;
    };
    const appRewrite = vercel.rewrites?.find((rule) => rule.destination === "/index.html");

    expect(appRewrite?.source).toContain("_vercel/");
  });
});
