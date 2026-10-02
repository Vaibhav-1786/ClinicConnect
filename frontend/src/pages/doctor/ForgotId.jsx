import React, { useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import RecoveryPageShell from "../../components/recovery/RecoveryPageShell";

export default function DoctorForgotId() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devId, setDevId] = useState(null);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/auth/forgot-doctor-id", { email });
      setSent(true);
      if (res.data.dev_doctor_id) setDevId(res.data.dev_doctor_id);
    } catch (err) {
      showToast(err.response?.data?.error || t("forgotId.failed"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <RecoveryPageShell title={t("forgotId.doctorTitle")}>
      {sent ? (
        <>
          <p>{t("forgotId.checkEmail")}</p>
          {devId && (
            <div style={{ background: "var(--bg)", border: "1px dashed var(--border)", borderRadius: 8, padding: 10, marginTop: 10 }}>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{t("forgotPassword.devModeNotice")}</p>
              <strong style={{ fontSize: 14 }}>{devId}</strong>
            </div>
          )}
          <p style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
            <Link to="/doctor/login">{t("forgotPassword.backToLogin")}</Link>
            <Link to="/doctor/forgot-clinic-id">{t("login.forgotClinicId")}</Link>
          </p>
        </>
      ) : (
        <form onSubmit={submit}>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("forgotId.intro")}</p>
          <label>{t("login.emailLabel")}</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <button className="btn" style={{ width: "100%" }} disabled={loading}>
            {loading ? t("forgotPassword.sending") : t("forgotId.sendButton")}
          </button>
          <p style={{ fontSize: 13, marginTop: 14 }}>
            <Link to="/doctor/login">{t("forgotPassword.backToLogin")}</Link>
          </p>
        </form>
      )}
    </RecoveryPageShell>
  );
}
