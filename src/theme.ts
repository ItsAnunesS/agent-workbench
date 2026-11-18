import { useLayoutEffect, useState } from "react";

export type Theme = "dark" | "light";
export type ThemePreference = Theme | "system";
const storageKey = "workbench.theme";

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === "dark" || value === "light") return value;
  } catch {
    // A blocked storage area must not prevent the app from opening.
  }
  return "system";
}
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#1b1c20" : "#f5f4f1");
}

// Set the palette before rendering the first React screen.
const media = window.matchMedia("(prefers-color-scheme: dark)");
const initialPreference = readPreference();
applyTheme(
  initialPreference === "system"
    ? media.matches
      ? "dark"
      : "light"
    : initialPreference,
);

export function useTheme() {
  const [preference, setPreference] =
    useState<ThemePreference>(initialPreference);
  const [systemDark, setSystemDark] = useState(media.matches);
  const theme: Theme =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;
  useLayoutEffect(() => {
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);
  function selectTheme(value: ThemePreference) {
    setPreference(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // Keep the chosen appearance in memory when persistent storage is unavailable.
    }
  }
  return { preference, theme, selectTheme };
}
