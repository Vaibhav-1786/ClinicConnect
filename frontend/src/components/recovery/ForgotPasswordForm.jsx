import React, { useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

/**
 * Shared "forgot password" form used by Patient, Doctor, and Receptionist
 * recovery pages. A user has exactly one password on their `users` row no
 * matter which role they are, so the same generic-email flow (and the same
 * backend endpoint, /api/auth/forgot-password) works for all three — this
 * component just varies the copy/back-link per role via props.
 *
 * Always shows the same generic "if this exists, we sent a link" message,
 * regardless of whether the email actually matched an account.
 */
export default function ForgotPasswordForm({ loginPath, extraLinks }) {
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
      // Only ever present in local/dev mode when no SMTP is configured —
      // the backend never includes this in production (see Config.IS_PRODUCTION).
      if (res.data.dev_reset_link) setDevLink(res.data.dev_reset_link);
    } catch (err) {
      showToast(err.response?.data?.error || t("forgotPassword.failed"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
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
            <Link to={loginPath}>{t("forgotPassword.backToLogin")}</Link>
          </p>
        </>
      ) : (
        <form onSubmit={submit}>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("forgotPassword.intro")}</p>
          <label>{t("login.emailLabel")}</label>
          <input
            className="input" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} required autoFocus
            aria-label={t("login.emailLabel")}
          />
          <button className="btn" style={{ width: "100%" }} disabled={loading}>
            {loading ? t("forgotPassword.sending") : t("forgotPassword.sendLink")}
          </button>
          <p style={{ fontSize: 13, marginTop: 14 }}>
            <Link to={loginPath}>{t("forgotPassword.backToLogin")}</Link>
          </p>
          {extraLinks}
        </form>
      )}
    </>
  );
}
