import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

export default function GlobalSearch() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { role } = useAuth();
  const { t } = useLanguage();

  const submit = (e) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    navigate(`/${role}/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <form onSubmit={submit} className="global-search">
      <input
        className="input"
        style={{ margin: 0 }}
        aria-label={t("common.search")}
        placeholder={t("common.search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </form>
  );
}
