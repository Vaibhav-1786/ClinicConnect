import React from "react";
import ThemeToggle from "../ThemeToggle";
import LanguageSelector from "../LanguageSelector";

/**
 * Same chrome the existing patient/ForgotPassword.jsx and
 * patient/ResetPassword.jsx pages already use (top bar with theme/language
 * controls + a centered auth-card), factored out so every new recovery
 * page — Doctor/Receptionist forgot-password, forgot-ID, forgot-clinic-ID —
 * looks and behaves identically instead of re-implementing this shell.
 */
export default function RecoveryPageShell({ title, children }) {
  return (
    <div className="auth-page">
      <div className="auth-top-bar" style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
        <LanguageSelector />
        <ThemeToggle compact />
      </div>
      <div className="auth-card">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
