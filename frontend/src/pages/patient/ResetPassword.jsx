import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import ThemeToggle from "../../components/ThemeToggle";
import LanguageSelector from "../../components/LanguageSelector";

const VALID_ROLES = ["patient", "doctor", "receptionist", "admin"];

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  // The reset email's link carries ?role=... (see backend forgot_password)
  // purely so this single shared page knows which login page to send the
  // user back to. It plays no part in validating the token itself — that
  // still happens entirely server-side against the token alone. Defaults to
  // "patient" so any old/pre-existing reset links without the param still work.
  const roleParam = searchParams.get("role") || "patient";
  const role = VALID_ROLES.includes(roleParam) ? roleParam : "patient";
  const loginPath = `/${role}/login`;

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const { showToast } = useToast();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      showToast(t("resetPassword.tooShort"), "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast(t("resetPassword.mismatch"), "error");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { reset_token: token, new_password: newPassword });
      setDone(true);
      showToast(t("resetPassword.success"), "success");
      setTimeout(() => navigate(loginPath), 2000);
    } catch (err) {
      showToast(err.response?.data?.error || t("resetPassword.failed"), "error");
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
        <h2>{t("resetPassword.title")}</h2>

        {!token ? (
          <>
            <p>{t("resetPassword.noToken")}</p>
            {/* Admin has no dedicated forgot-password page yet — send back to its login instead. */}
            <Link to={role === "admin" ? "/admin/login" : `/${role}/forgot-password`}>{t("forgotPassword.title")}</Link>
          </>
        ) : done ? (
          <p>{t("resetPassword.success")}</p>
        ) : (
          <form onSubmit={submit}>
            <label>{t("resetPassword.newPassword")}</label>
            <input className="input" type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            <label>{t("resetPassword.confirmPassword")}</label>
            <input className="input" type="password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            <button className="btn" style={{ width: "100%" }} disabled={loading}>
              {loading ? t("resetPassword.saving") : t("resetPassword.submit")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
