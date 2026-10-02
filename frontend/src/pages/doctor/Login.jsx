import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import LanguageSelector from "../../components/LanguageSelector";
import ThemeToggle from "../../components/ThemeToggle";

export default function DoctorLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/auth/doctor/login", { email, password });
      login("doctor", res.data.token, res.data.doctor);
      showToast(t("docLogin.welcome"), "success");
      navigate("/doctor/dashboard");
    } catch (err) {
      showToast(err.response?.data?.error || t("docLogin.failed"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-top-bar">
        <LanguageSelector />
        <ThemeToggle compact />
      </div>
      <div className="auth-card">
        <div className="auth-tabs">
          <Link to="/patient/login">{t("common.patient", "Patient")}</Link>
          <Link to="/receptionist/login">{t("common.receptionist", "Receptionist")}</Link>
          <Link to="/doctor/login" className="active">{t("common.doctor", "Doctor")}</Link>
        </div>
        <h2>{t("login.doctorTitle")}</h2>
        <form onSubmit={submit}>
          <label>{t("login.emailLabel")}</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>{t("login.passwordLabel")}</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn" style={{ width: "100%" }} disabled={loading}>
            {loading ? t("login.signingIn") : t("login.loginButton")}
          </button>
        </form>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 14 }}>Demo: doctor@demo.com / Password123</p>
      </div>
    </div>
  );
}
