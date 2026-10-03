import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * The app and the public site share one grid: four width tiers and a 4px
 * spacing scale (--sp-1..--sp-7). These checks keep new CSS from drifting
 * back to one-off breakpoints and off-scale gaps. A declaration that must be
 * off-grid (an optical nudge) says why with an `off-grid` comment on its line.
 */
const root = join(import.meta.dir, "..", "..");
const SOURCES = [
  "src/frontend/styles/ledger.css",
  "src/frontend/styles/journal.css",
  "website/site.css",
  "website/folio.css",
  "website/index.html",
  "website/offers.html",
  "website/services.html",
];
// phone ≤639 · tablet 640–1023 · laptop 1024–1279 · desktop ≥1280 (379: very small phones)
const TIER_WIDTHS = new Set([379, 639, 640, 1023, 1024, 1279, 1280]);

/** CSS text of a source: the file itself, or the <style> blocks of an HTML page. */
function cssOf(file: string): string {
  const text = readFileSync(join(root, file), "utf8");
  if (!file.endsWith(".html")) return text;
  return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
}

describe("layout tiers and spacing scale", () => {
  test("every width media query is a tier boundary", () => {
    const strays: string[] = [];
    for (const file of SOURCES) {
      for (const [prelude] of cssOf(file).matchAll(/@media[^{]*/g)) {
        for (const [, px] of prelude.matchAll(/(?:min|max)-width:\s*(\d+)px/g)) {
          if (!TIER_WIDTHS.has(Number(px))) strays.push(`${file}: ${prelude.trim()}`);
        }
      }
    }
    expect(strays).toEqual([]);
  });

  test("padding, margin and gap px values sit on the 4px grid", () => {
    const strays: string[] = [];
    for (const file of SOURCES) {
      for (const line of cssOf(file).split("\n")) {
        const decl = line.match(
          /(?:^|[;{\s])(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;}]+)/,
        );
        if (!decl || line.includes("off-grid")) continue;
        const value = (decl[1] ?? "").replace(/var\([^)]*\)|env\([^)]*\)/g, "");
        for (const [, num] of value.matchAll(/(-?\d*\.?\d+)px/g)) {
          const px = Math.abs(Number(num));
          if (px !== 1 && px !== 2 && px % 4 !== 0) strays.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(strays).toEqual([]);
  });
});
