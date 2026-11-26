import { expect, test } from "bun:test";
import { ACCENTS, DEFAULT_ACCENT_NAME } from "../src/lib/accents";
import { SURFACES } from "../src/lib/surfaces";

const css = await Bun.file(new URL("../src/frontend/styles/ledger.css", import.meta.url)).text();

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector + " {");
  if (start === -1) throw new Error(`Missing theme selector ${selector}`);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    Array.from(block.matchAll(/--([\w-]+): (#[\da-f]{6});/gi), ([, key, color]) => [key, color]),
  );
}

function luminance(hex: string): number {
  const channel = (start: number): number => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const mode of ["light", "dark"] as const) {
  const themeSelector = `:root[data-theme="${mode}"]`;
  const theme = tokens(themeSelector);
  test(`initial ${mode} paint uses the default accent`, () => {
    expect(theme.accent ?? tokens(":root").accent).toBe(ACCENTS[DEFAULT_ACCENT_NAME][mode]);
  });

  for (const [ground, swatch] of Object.entries(SURFACES)) {
    const palette =
      ground === "bone"
        ? theme
        : { ...theme, ...tokens(`${themeSelector}[data-surface="${ground}"]`) };
    for (const [name, preset] of Object.entries(ACCENTS)) {
      test(`${mode} ${ground} surface with ${name} accent`, () => {
        const accent = tokens(
          `${mode === "dark" ? themeSelector : ":root"}[data-accent="${name}"]`,
        );
        expect(accent.accent).toBe(preset[mode]);
        expect(palette.bg).toBe(mode === "dark" ? swatch.swatchDark : swatch.swatchLight);
        expect(contrast(accent.accent!, accent["accent-contrast"]!)).toBeGreaterThanOrEqual(4.5);
        for (const background of ["bg", "surface", "surface-2", "surface-3"]) {
          for (const color of ["ink", "ink-soft", "ink-faint", "danger", "ok", "saved"]) {
            expect(contrast(palette[color]!, palette[background]!)).toBeGreaterThanOrEqual(4.5);
          }
          expect(contrast(accent.accent!, palette[background]!)).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
}
