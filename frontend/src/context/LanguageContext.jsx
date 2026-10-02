import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import translations from "../i18n/translations";
import api from "../services/api";

const LanguageContext = createContext(null);

function lookup(dict, key) {
  return key.split(".").reduce((obj, part) => (obj && obj[part] !== undefined ? obj[part] : undefined), dict);
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => localStorage.getItem("language") || "en");

  // If the account already has a saved preference (set on another device,
  // or before this browser had one), pull it in once on load.
  useEffect(() => {
    const token = sessionStorage.getItem("token");
    if (!token) return;
    api.get("/auth/language").then((r) => {
      if (r.data.language && r.data.language !== language) {
        setLanguageState(r.data.language);
        localStorage.setItem("language", r.data.language);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLanguage = useCallback((lang) => {
    setLanguageState(lang);
    localStorage.setItem("language", lang);
    if (sessionStorage.getItem("token")) {
      api.post("/auth/language", { language: lang }).catch(() => {});
    }
  }, []);

  const t = useCallback((key, fallback) => {
    const dict = translations[language] || translations.en;
    const value = lookup(dict, key);
    if (value !== undefined) return value;
    const enValue = lookup(translations.en, key);
    if (enValue !== undefined) return enValue;
    return fallback !== undefined ? fallback : key;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
