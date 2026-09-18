import {
  applyAccent,
  applySurface,
  applyTheme,
  getStoredAccent,
  getStoredSurface,
  getStoredTheme,
  getSystemDark,
  resolveAccent,
  setStoredAccent,
  setStoredSurface,
  setStoredTheme,
  type AccentName,
  type SurfaceName,
  type ThemePreference,
} from "@/frontend/lib/theme";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type ThemeContextValue = {
  preference: ThemePreference;
  dark: boolean;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
  /** Accent color pick — name plus the resolved hex/contrast for
      the current theme, so charts re-render on either changing instead of
      reading a stale `--accent` off the DOM. */
  accentName: AccentName;
  accent: string;
  accentContrast: string;
  setAccentName: (name: AccentName) => void;
  /** Base surface (neutral ground) pick — name only, the tokens live in CSS. */
  surfaceName: SurfaceName;
  setSurfaceName: (name: SurfaceName) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => getStoredTheme());
  const [systemDark, setSystemDark] = useState(() => getSystemDark());
  const [accentName, setAccentNameState] = useState<AccentName>(() => getStoredAccent());
  const [surfaceName, setSurfaceNameState] = useState<SurfaceName>(() => getStoredSurface());
  const dark = preference === "system" ? systemDark : preference === "dark";
  const { hex: accent, contrast: accentContrast } = resolveAccent(accentName, dark);

  useEffect(() => {
    applyTheme(dark);
    setStoredTheme(preference);
  }, [dark, preference]);

  useEffect(() => {
    applyAccent(accentName);
  }, [accentName]);

  useEffect(() => {
    applySurface(surfaceName);
  }, [surfaceName]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* useCallback here isn't optional: LedgerApp mirrors the server profile's
     accent into this via an effect keyed on setAccentName's identity
     (see LedgerApp.tsx). An unmemoized setAccentName gets a new identity on
     every ThemeProvider render — including the one a pick itself causes —
     which re-fires that effect and overwrites the fresh pick with the
     still-stale react-query profile cache. */
  const setPreference = useCallback((next: ThemePreference) => setPreferenceState(next), []);
  const toggle = useCallback(() => setPreferenceState(dark ? "light" : "dark"), [dark]);
  const setAccentName = useCallback((name: AccentName) => {
    setAccentNameState(name);
    setStoredAccent(name);
  }, []);
  const setSurfaceName = useCallback((name: SurfaceName) => {
    setSurfaceNameState(name);
    setStoredSurface(name);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        preference,
        dark,
        setPreference,
        toggle,
        accentName,
        accent,
        accentContrast,
        setAccentName,
        surfaceName,
        setSurfaceName,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
