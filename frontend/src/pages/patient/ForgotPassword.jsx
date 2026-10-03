import React, { useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import ThemeToggle from "../../components/ThemeToggle";
import LanguageSelector from "../../components/LanguageSelector";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState(null);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/auth/forgot-password", { email });
      setSent(true);
      // Only present when no SMTP is configured yet — lets local/dev testing
      // continue working without a real mail server.
      if (res.data.dev_reset_link) setDevLink(res.data.dev_reset_link);
    } catch (err) {
      showToast(err.response?.data?.error || t("forgotPassword.failed"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-top-bar" style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
        <LanguageSelector />
        <ThemeToggle compact />
      </div>
      <div className="auth-card">
        <h2>{t("forgotPassword.title")}</h2>

        {sent ? (
          <>
            <p>{t("forgotPassword.checkEmail")}</p>
            {devLink && (
              <div style={{ background: "var(--bg)", border: "1px dashed var(--border)", borderRadius: 8, padding: 10, marginTop: 10 }}>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                  {t("forgotPassword.devModeNotice")}
                </p>
                <a href={devLink} style={{ fontSize: 12, wordBreak: "break-all" }}>{devLink}</a>
              </div>
            )}
            <p style={{ marginTop: 16 }}>
              <Link to="/patient/login">{t("forgotPassword.backToLogin")}</Link>
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("forgotPassword.intro")}</p>
            <label>{t("login.emailLabel")}</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button className="btn" style={{ width: "100%" }} disabled={loading}>
              {loading ? t("forgotPassword.sending") : t("forgotPassword.sendLink")}
            </button>
            <p style={{ fontSize: 13, marginTop: 14 }}>
              <Link to="/patient/login">{t("forgotPassword.backToLogin")}</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
