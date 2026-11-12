"use client";

import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";

export default function ThemeToggle({ className, variant = "default" }) {
  const { isDark, toggleTheme } = useTheme();

  // The `.dark` class is applied to <html> before first paint by the
  // inline script in layout.js, but useTheme's system-theme snapshot
  // reads false during hydration when theme === "system" — so isDark
  // is briefly false on a dark page and the label/icon flash wrong.
  // The DOM class is the effective theme; prefer it when present.
  const domIsDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");
  const effectiveDark = isDark || domIsDark;

  const variants = {
    // Header button: same bordered treatment as the other header
    // buttons, so the toggle does not read as a floating glyph.
    default: cn(
      "flex items-center justify-center size-8 rounded-md",
      "border border-zinc-300 dark:border-zinc-700",
      "text-[var(--daytona-text-muted)] hover:text-[var(--daytona-text)]",
      "hover:bg-[var(--daytona-panel-2)] transition-colors"
    ),
    card: cn(
      "flex items-center justify-center size-11 rounded-full",
      "bg-surface/60 hover:bg-surface",
      "border border-border",
      "backdrop-blur-md shadow-sm hover:shadow-[var(--shadow-warm)]",
      "text-text-muted hover:text-brand-500",
      "transition-all group"
    ),
  };

  return (
    <button
      onClick={toggleTheme}
      className={cn(variants[variant], className)}
      aria-label={`Switch to ${effectiveDark ? "light" : "dark"} mode`}
      title={`Switch to ${effectiveDark ? "light" : "dark"} mode`}
    >
      <span
        className={cn(
          "material-symbols-outlined text-[20px]",
          variant === "card" && "transition-transform duration-300 group-hover:rotate-12"
        )}
      >
        {effectiveDark ? "light_mode" : "dark_mode"}
      </span>
    </button>
  );
}
