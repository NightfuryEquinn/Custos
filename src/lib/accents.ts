/**
 * Accent color pick — the shared name/hex map. Lives here
 * (not @/frontend/lib/theme) so both the frontend theme module and the
 * server-side profile schema (which validates `accent` on PATCH /profile)
 * can import the same list without a schema depending on frontend UI code.
 *
 * Kept in sync with the matching `[data-accent="x"]` blocks in ledger.css —
 * the "accent map and CSS agree" test in theme-contrast.test.ts is what
 * catches the two copies drifting apart.
 */
export const ACCENTS = {
  clay: { light: "#8f6140", dark: "#c98f63", contrastLight: "#ffffff", contrastDark: "#1a1714" },
  moss: { light: "#3f7a52", dark: "#8fc79a", contrastLight: "#ffffff", contrastDark: "#1a1714" },
  azure: { light: "#3a6ea5", dark: "#8fb8e8", contrastLight: "#ffffff", contrastDark: "#1a1714" },
  berry: { light: "#8a4568", dark: "#d99bb8", contrastLight: "#ffffff", contrastDark: "#1a1714" },
  plum: { light: "#6b4c9a", dark: "#b9a0e0", contrastLight: "#ffffff", contrastDark: "#1a1714" },
  teal: { light: "#2f7570", dark: "#7fc9c1", contrastLight: "#ffffff", contrastDark: "#1a1714" },
  amber: { light: "#8a6216", dark: "#d8ab5c", contrastLight: "#ffffff", contrastDark: "#1a1714" },
  steel: { light: "#4f6070", dark: "#a3b5c4", contrastLight: "#ffffff", contrastDark: "#1a1714" },
} as const;

export type AccentName = keyof typeof ACCENTS;
export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];
export const DEFAULT_ACCENT_NAME: AccentName = "clay";
