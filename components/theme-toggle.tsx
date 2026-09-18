"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "./icons";

// Tema: la clase .dark en <html> la pone el script del root layout; acá solo la
// leemos y la alternamos. Se sincroniza vía store externo para que varios
// montajes del botón (y el render del server) coincidan.
const themeListeners = new Set<() => void>();
const subscribeTheme = (cb: () => void) => {
  themeListeners.add(cb);
  return () => themeListeners.delete(cb);
};
const isDark = () => document.documentElement.classList.contains("dark");

function toggleTheme() {
  const dark = document.documentElement.classList.toggle("dark");
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {}
  themeListeners.forEach((cb) => cb());
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);
  const label = dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";

  return (
    <button type="button" className="icon-btn" onClick={toggleTheme} title={label} aria-label={label}>
      <Icon name={dark ? "sun" : "moon"} size={19} strokeWidth={1.8} />
    </button>
  );
}
