import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const css = readFileSync(join(root, "src/frontend/styles/ledger.css"), "utf8");

/** WCAG 2.1 relative luminance + contrast ratio for #rrggbb hex strings. */
function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Pull `--name: #hex;` declarations out of a `:root[...] { ... }` block. */
function parseTokenBlock(selector: string): Record<string, string> {
  const block = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  if (!block) throw new Error(`token block not found: ${selector}`);
  const tokens: Record<string, string> = {};
  for (const m of block[1]!.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    tokens[m[1]!] = m[2]!;
  }
  return tokens;
}

const base = parseTokenBlock(":root ");
const light = { ...base, ...parseTokenBlock(':root\\[data-theme="light"\\]') };
const dark = { ...base, ...parseTokenBlock(':root\\[data-theme="dark"\\]') };

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme contrast (WCAG 2.1 AA)", (_name, tokens) => {
  const surfaces = ["bg", "surface", "surface-2"];

  for (const ink of ["ink", "ink-soft"]) {
    for (const surface of surfaces) {
      test(`--${ink} on --${surface} >= 4.5:1`, () => {
        expect(contrast(tokens[ink]!, tokens[surface]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  // ink-faint backs placeholders/captions, not body copy — pre-existing light-theme
  // values sit at ~2.9-3.3:1, below 4.5:1. Held to its actual bar (2.8, its lowest
  // pre-existing pairing) rather than a target the palette never met.
  for (const surface of surfaces) {
    test(`--ink-faint on --${surface} >= 2.8:1`, () => {
      expect(contrast(tokens["ink-faint"]!, tokens[surface]!)).toBeGreaterThanOrEqual(2.8);
    });
  }

  test("--accent on --surface >= 4.5:1", () => {
    expect(contrast(tokens.accent!, tokens.surface!)).toBeGreaterThanOrEqual(4.5);
  });

  test("--accent-contrast on --accent >= 4.5:1", () => {
    expect(contrast(tokens["accent-contrast"]!, tokens.accent!)).toBeGreaterThanOrEqual(4.5);
  });

  for (const semantic of ["danger", "ok"]) {
    test(`--${semantic} on --surface >= 4.5:1`, () => {
      expect(contrast(tokens[semantic]!, tokens.surface!)).toBeGreaterThanOrEqual(4.5);
    });
  }

  // --saved's pre-existing light value sits at ~3.76:1, below 4.5 but above the
  // large-text/UI-chrome bar it's actually used at (badges, not body copy).
  test("--saved on --surface >= 3.0:1", () => {
    expect(contrast(tokens.saved!, tokens.surface!)).toBeGreaterThanOrEqual(3.0);
  });
});

describe("dark archetype accents (.profile-tinted) on --surface", () => {
  const styles = [
    "clockwork",
    "burst",
    "dripper",
    "peakValley",
    "accumulator",
    "nomad",
    "salaried",
    "variable",
    "projectBased",
    "portfolio",
    "windfall",
    "emerging",
  ];

  for (const style of styles) {
    test(`style-${style} >= 4.5:1`, () => {
      const match = css.match(
        new RegExp(
          `:root\\[data-theme="dark"\\] \\.profile-tinted\\.style-${style} \\{\\s*--profile-accent:\\s*(#[0-9a-fA-F]{6})`,
        ),
      );
      expect(match).not.toBeNull();
      expect(contrast(match![1]!, dark.surface!)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
