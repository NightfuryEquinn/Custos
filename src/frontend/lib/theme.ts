/* ────────────────────────────────────────────────────────────────────
   Theme helpers
   ────────────────────────────────────────────────────────────────────
   The design system lives in styles/ledger.css (tokens for color,
   radius, spacing). This module handles the light/dark preference and
   the Supporter accent perk, and resolves the accent color for
   SVG charts (which can't read CSS custom properties directly).

   Dark theme tokens in ledger.css target WCAG 2.1 AA contrast
   (≥ 4.5:1 normal text, ≥ 3.0:1 large text / UI). resolveAccent() takes
   the current theme as an explicit argument rather than reading the DOM,
   so callers re-render (and repaint charts) on a theme or accent change
   instead of silently keeping a stale color.
   ──────────────────────────────────────────────────────────────────── */

import { ACCENTS, DEFAULT_ACCENT_NAME, type AccentName } from "@/lib/accents";
export { ACCENTS, ACCENT_NAMES, type AccentName } from "@/lib/accents";

export type ThemePreference = "light" | "dark" | "system";

const THEME_KEY = "ledger:theme";
const ACCENT_KEY = "ledger:accent";

export function getSystemDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getStoredTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* ignore */
  }
  return "system";
}

export function setStoredTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch {
    /* ignore */
  }
}

export function resolveDark(preference: ThemePreference): boolean {
  if (preference === "dark") return true;
  if (preference === "light") return false;
  return getSystemDark();
}

export function applyTheme(dark: boolean): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.style.colorScheme = dark ? "dark" : "light";
}

export function getStoredAccent(): AccentName {
  try {
    const value = localStorage.getItem(ACCENT_KEY);
    if (value && value in ACCENTS) return value as AccentName;
  } catch {
    /* ignore */
  }
  return DEFAULT_ACCENT_NAME;
}

export function setStoredAccent(name: AccentName): void {
  try {
    localStorage.setItem(ACCENT_KEY, name);
  } catch {
    /* ignore */
  }
}

/** Set `data-accent` on `<html>` so the matching ledger.css block applies. */
export function applyAccent(name: AccentName): void {
  document.documentElement.setAttribute("data-accent", name);
}

/** Resolve the hex + contrast pair for an accent name in the given theme. */
export function resolveAccent(name: AccentName, dark: boolean): { hex: string; contrast: string } {
  const tokens = ACCENTS[name] ?? ACCENTS[DEFAULT_ACCENT_NAME];
  return dark
    ? { hex: tokens.dark, contrast: tokens.contrastDark }
    : { hex: tokens.light, contrast: tokens.contrastLight };
}
