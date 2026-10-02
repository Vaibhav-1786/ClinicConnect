import React from "react";
import { useTheme } from "../context/ThemeContext";

const ICONS = {
  light: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 2v2.2M12 19.8V22M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2 12h2.2M19.8 12H22M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
      </g>
    </svg>
  ),
  dark: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a.6.6 0 0 0-.75-.78A9.5 9.5 0 1 0 21.28 15.35a.6.6 0 0 0-.78-.75Z"
        fill="currentColor"
      />
    </svg>
  ),
  system: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 20h7M12 16.5V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
};

const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * Three-way Light / Dark / System toggle. Centralized here so every login
 * page (and the dashboard topbar) renders the exact same control instead of
 * duplicating theme logic.
 */
export default function ThemeToggle({ compact = false }) {
  const { preference, setPreference } = useTheme();

  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`theme-toggle-btn${preference === opt.value ? " active" : ""}`}
          onClick={() => setPreference(opt.value)}
          title={opt.label}
          aria-pressed={preference === opt.value}
        >
          <span aria-hidden="true" className="theme-toggle-icon">{ICONS[opt.value]}</span>
          {!compact && <span className="theme-toggle-label">{opt.label}</span>}
        </button>
      ))}
    </div>
  );
}