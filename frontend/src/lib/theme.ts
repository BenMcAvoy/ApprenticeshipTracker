import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "theme";

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && prefersDark()));
}

/** Light / dark / follow-the-system, remembered in localStorage (index.html applies it before first paint). */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem(KEY) as Theme | null) ?? "system");

  useEffect(() => {
    apply(theme);
    if (theme !== "system") return;
    // Follow the OS while set to "system".
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = (next: Theme) => {
    localStorage.setItem(KEY, next);
    setThemeState(next);
  };
  return { theme, setTheme };
}
