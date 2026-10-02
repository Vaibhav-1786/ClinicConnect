import React, { useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import RecoveryPageShell from "../../components/recovery/RecoveryPageShell";

/**
 * Used by both /doctor/forgot-clinic-id and /receptionist/forgot-clinic-id.
 * Accepts either the account's registered email OR its role-specific ID
 * (Doctor ID / Receptionist ID) — whichever the user has handy — and, if it
 * matches exactly one account, emails that account every Clinic/Hospital ID
 * it's authorized to use (a Doctor may have several). Never reveals another
 * user's organizations.
 */
export default function ForgotClinicId({ role }) {
  const isDoctor = role === "doctor";
  const idLabel = isDoctor ? "Doctor ID" : "Receptionist ID";
  const idField = isDoctor ? "doctor_id" : "receptionist_id";
  const idPlaceholder = isDoctor ? "DOC-000001" : "REC-000001";
  const loginPath = isDoctor ? "/doctor/login" : "/receptionist/login";

  const [mode, setMode] = useState("email"); // "email" | "id"
  const [email, setEmail] = useState("");
  const [idValue, setIdValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devClinics, setDevClinics] = useState(null);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = mode === "email" ? { email } : { [idField]: idValue };
      const res = await api.post("/auth/forgot-clinic-id", payload);
      setSent(true);
      if (res.data.dev_clinics) setDevClinics(res.data.dev_clinics);
    } catch (err) {
      showToast(err.response?.data?.error || t("forgotClinicId.failed"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <RecoveryPageShell title={t("forgotClinicId.title")}>
      {sent ? (
        <>
          <p>{t("forgotClinicId.checkEmail")}</p>
          {devClinics && (
            <div style={{ background: "var(--bg)", border: "1px dashed var(--border)", borderRadius: 8, padding: 10, marginTop: 10 }}>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{t("forgotPassword.devModeNotice")}</p>
              {devClinics.length === 0 ? (
                <p style={{ fontSize: 13, margin: "6px 0 0" }}>{t("forgotClinicId.noneFound")}</p>
              ) : (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {devClinics.map((c) => (
                    <li key={c.clinic_code} style={{ fontSize: 13 }}><strong>{c.clinic_code}</strong> — {c.name}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p style={{ marginTop: 16 }}>
            <Link to={loginPath}>{t("forgotPassword.backToLogin")}</Link>
          </p>
        </>
      ) : (
        <form onSubmit={submit}>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("forgotClinicId.intro")}</p>

          <div className="auth-tabs" role="tablist" aria-label={t("forgotClinicId.lookupBy")}>
            <a
              href="#" className={mode === "email" ? "active" : ""} role="tab" aria-selected={mode === "email"}
              onClick={(ev) => { ev.preventDefault(); setMode("email"); }}
            >
              {t("login.emailLabel")}
            </a>
            <a
              href="#" className={mode === "id" ? "active" : ""} role="tab" aria-selected={mode === "id"}
              onClick={(ev) => { ev.preventDefault(); setMode("id"); }}
            >
              {idLabel}
            </a>
          </div>

          {mode === "email" ? (
            <>
              <label>{t("login.emailLabel")}</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </>
          ) : (
            <>
              <label>{idLabel}</label>
              <input className="input" placeholder={idPlaceholder} value={idValue} onChange={(e) => setIdValue(e.target.value)} required autoFocus />
            </>
          )}

          <button className="btn" style={{ width: "100%" }} disabled={loading}>
            {loading ? t("forgotPassword.sending") : t("forgotClinicId.sendButton")}
          </button>
          <p style={{ fontSize: 13, marginTop: 14 }}>
            <Link to={loginPath}>{t("forgotPassword.backToLogin")}</Link>
          </p>
        </form>
      )}
    </RecoveryPageShell>
  );
}
