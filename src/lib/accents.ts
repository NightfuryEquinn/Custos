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
  clay: {
    label: "Persimmon",
    light: "#8e432d",
    dark: "#e6a08a",
    contrastLight: "#ffffff",
    contrastDark: "#191d22",
  },
  moss: {
    label: "Moss",
    light: "#425836",
    dark: "#b2c999",
    contrastLight: "#ffffff",
    contrastDark: "#191d22",
  },
  azure: {
    label: "Indigo",
    light: "#294567",
    dark: "#abc8ed",
    contrastLight: "#ffffff",
    contrastDark: "#191d22",
  },
  berry: {
    label: "Azuki",
    light: "#773f4a",
    dark: "#e3a7b0",
    contrastLight: "#ffffff",
    contrastDark: "#191d22",
  },
  plum: {
    label: "Plum",
    light: "#624567",
    dark: "#d0acd3",
    contrastLight: "#ffffff",
    contrastDark: "#191d22",
  },
  teal: {
    label: "Celadon",
    light: "#325e56",
    dark: "#9dcabc",
    contrastLight: "#ffffff",
    contrastDark: "#191d22",
  },
  amber: {
    label: "Ochre",
    light: "#6c5020",
    dark: "#dfbb80",
    contrastLight: "#ffffff",
    contrastDark: "#191d22",
  },
  steel: {
    label: "Iron gray",
    light: "#46535a",
    dark: "#b1c1c8",
    contrastLight: "#ffffff",
    contrastDark: "#191d22",
  },
} as const;

export type AccentName = keyof typeof ACCENTS;
export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];
export const DEFAULT_ACCENT_NAME: AccentName = "azure";
