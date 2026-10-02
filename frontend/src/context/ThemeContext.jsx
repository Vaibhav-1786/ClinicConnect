import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const ThemeContext = createContext(null);
const STORAGE_KEY = "theme"; // "light" | "dark" | "system"

function getSystemPrefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveEffective(preference) {
  if (preference === "system") return getSystemPrefersDark() ? "dark" : "light";
  return preference;
}

function applyToDocument(effective) {
  document.documentElement.setAttribute("data-theme", effective);
}

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || "system"
  );
  const [effective, setEffective] = useState(() => resolveEffective(preference));

  // Apply immediately on mount and whenever the preference changes.
  useEffect(() => {
    const next = resolveEffective(preference);
    setEffective(next);
    applyToDocument(next);
  }, [preference]);

  // While "system" is selected, react live to OS-level theme changes.
  useEffect(() => {
    if (preference !== "system" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const next = resolveEffective("system");
      setEffective(next);
      applyToDocument(next);
    };
    mq.addEventListener ? mq.addEventListener("change", handler) : mq.addListener(handler);
    return () => {
      mq.removeEventListener ? mq.removeEventListener("change", handler) : mq.removeListener(handler);
    };
  }, [preference]);

  const setPreference = useCallback((value) => {
    localStorage.setItem(STORAGE_KEY, value);
    setPreferenceState(value);
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, effective, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
