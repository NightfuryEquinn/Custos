import {
  applyAccent,
  applyTheme,
  getStoredAccent,
  getStoredTheme,
  getSystemDark,
  resolveAccent,
  setStoredAccent,
  setStoredTheme,
  type AccentName,
  type ThemePreference,
} from "@/frontend/lib/theme";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type ThemeContextValue = {
  preference: ThemePreference;
  dark: boolean;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
  /** Supporter accent perk — name plus the resolved hex/contrast for
      the current theme, so charts re-render on either changing instead of
      reading a stale `--accent` off the DOM. */
  accentName: AccentName;
  accent: string;
  accentContrast: string;
  setAccentName: (name: AccentName) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => getStoredTheme());
  const [systemDark, setSystemDark] = useState(() => getSystemDark());
  const [accentName, setAccentNameState] = useState<AccentName>(() => getStoredAccent());
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
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setPreference = (next: ThemePreference) => setPreferenceState(next);
  const toggle = () => setPreferenceState(dark ? "light" : "dark");
  const setAccentName = (name: AccentName) => {
    setAccentNameState(name);
    setStoredAccent(name);
  };

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
