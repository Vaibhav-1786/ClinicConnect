import React from "react";
import { useLanguage } from "../context/LanguageContext";
import { SUPPORTED_LANGUAGES } from "../i18n/translations";

export default function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <select
      className="language-selector"
      value={language}
      onChange={(e) => setLanguage(e.target.value)}
      aria-label={t("languageSelector.label")}
      style={{ width: "auto", minWidth: 96, margin: 0 }}
    >
      {SUPPORTED_LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>{l.label}</option>
      ))}
    </select>
  );
}