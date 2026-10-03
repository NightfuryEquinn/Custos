// Loaded as a blocking <head> script so the saved theme applies before first paint.
const STORAGE_KEY = "custos-site:theme";
const THEME_COLORS = { light: "#f5f4f0", dark: "#1a1714" } as const;

type Theme = keyof typeof THEME_COLORS;

const osDark = window.matchMedia("(prefers-color-scheme: dark)");

/** Read the saved theme, or null when the visitor has never toggled. */
function getSaved(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);

    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** Persist an explicit theme choice; storage may be unavailable in private modes. */
function save(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

/** Resolve the theme to show: the saved choice, else the OS preference. */
function resolve(): Theme {
  return getSaved() ?? (osDark.matches ? "dark" : "light");
}

/** Label the toggle with the action it will perform. */
function syncButton(theme: Theme) {
  const button = document.querySelector<HTMLButtonElement>(".folio-theme");

  button?.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  );
}

/** Apply a theme to <html>, the browser chrome colour and the toggle label. */
function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  syncButton(theme);
}

apply(resolve());

osDark.addEventListener("change", () => {
  if (!getSaved()) apply(resolve());
});

document.addEventListener("DOMContentLoaded", () => {
  const button = document.querySelector<HTMLButtonElement>(".folio-theme");

  if (!button) return;

  button.hidden = false;
  syncButton(resolve());
  button.addEventListener("click", () => {
    const next: Theme = resolve() === "dark" ? "light" : "dark";

    save(next);
    apply(next);
  });
});
