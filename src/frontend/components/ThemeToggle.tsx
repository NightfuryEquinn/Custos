import { Icon } from "@/frontend/components/ui";
import { useTheme } from "@/frontend/lib/hooks/useTheme";

type ThemeToggleProps = {
  className?: string;
};

export function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const { dark, toggle } = useTheme();

  return (
    <button
      type="button"
      className={"icon-btn theme-toggle" + (className ? ` ${className}` : "")}
      onClick={toggle}
      aria-label={dark ? "Switch to Light Mode" : "Switch to Dark Mode"}
    >
      <Icon name={dark ? "sun" : "moon"} size={18} />
      <span className="theme-toggle-label" aria-hidden="true">
        {dark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      </span>
    </button>
  );
}
