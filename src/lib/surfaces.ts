/**
 * Base surface (neutral ground) pick — the shared name list, mirroring the
 * @/lib/accents precedent so both the frontend theme module and the
 * server-side profile schema (which validates `surface` on PATCH /profile)
 * can import the same list without a schema depending on frontend UI code.
 *
 * Unlike ACCENTS, nothing outside CSS needs the actual token values here —
 * charts take a resolved accent hex as a prop, but nothing reads the surface
 * colors in JS — so this only carries the swatch shown in the picker UI.
 * The real per-theme tokens live in the matching `[data-surface="x"]` blocks
 * in ledger.css.
 */
export const SURFACES = {
  bone: { label: "Washi", swatchLight: "#f7f4eb", swatchDark: "#191d22" },
  slate: { label: "Blue-gray", swatchLight: "#eff3f5", swatchDark: "#141e25" },
  sage: { label: "Pale sage", swatchLight: "#f1f3e9", swatchDark: "#182019" },
  ink: { label: "Sumi", swatchLight: "#f2f1ee", swatchDark: "#171918" },
} as const;

export type SurfaceName = keyof typeof SURFACES;
export const SURFACE_NAMES = Object.keys(SURFACES) as SurfaceName[];
export const DEFAULT_SURFACE_NAME: SurfaceName = "bone";
