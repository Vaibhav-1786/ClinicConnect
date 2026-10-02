import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import ThemeToggle from "../../components/ThemeToggle";
import GoogleLoginButton from "../../components/GoogleLoginButton";
import LanguageSelector from "../../components/LanguageSelector";
import { useLanguage } from "../../context/LanguageContext";

/**
 * URL decides the role. There is no shared "pick your role" screen — the
 * three previous login tabs have been removed entirely.
 *
 *   /login, /patient, /patient/login   -> Patient Login   (default)
 *   /receptionist, /receptionist/login -> Receptionist Login
 *   /doctor, /doctor/login             -> Doctor Login
 *   /admin/login                       -> Admin Login
 */
function resolveRole(pathname) {
  if (pathname.startsWith("/receptionist")) return "receptionist";
  if (pathname.startsWith("/doctor")) return "doctor";
  if (pathname.startsWith("/admin")) return "admin";
  return "patient"; // /login, /patient, /patient/login and anything else default here
}

const COPY = {
  patient: { titleKey: "login.patientTitle", demo: "Demo: patient@demo.com / Password123" },
  receptionist: { titleKey: "login.receptionistTitle", demo: "Demo: use the ID + Clinic/Hospital ID printed by seed_demo.py" },
  doctor: { titleKey: "login.doctorTitle", demo: "Demo: use the ID + Clinic/Hospital ID printed by seed_demo.py" },
  admin: { titleKey: "login.adminTitle", demo: "Demo: admin@demo.com / Admin@123" },
};

export default function Login() {
  const { pathname } = useLocation();
  const role = resolveRole(pathname);
  const { login } = useAuth();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", doctor_id: "", clinic_id: "", receptionist_id: "" });
  const [otpChallenge, setOtpChallenge] = useState(null); // { pending_token, dev_otp }
  const [otp, setOtp] = useState("");

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const completeLogin = (data) => {
    if (role === "patient") {
      login("patient", data.token, data.patient);
      navigate("/patient/dashboard");
    } else if (role === "receptionist") {
      login("receptionist", data.token, data.receptionist, data.clinic);
      navigate("/receptionist/dashboard");
    } else if (role === "doctor") {
      login("doctor", data.token, data.doctor, data.clinic, data.organizations);
      navigate("/doctor/dashboard");
    } else if (role === "admin") {
      login("admin", data.token, data.admin);
      navigate("/admin/dashboard");
    }
    showToast("Welcome back!", "success");
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      let res;
      if (role === "patient") {
        res = await api.post("/auth/patient/login", { email: form.email, password: form.password });
      } else if (role === "receptionist") {
        res = await api.post("/auth/receptionist/login", {
          receptionist_id: form.receptionist_id, clinic_id: form.clinic_id, password: form.password,
        });
      } else if (role === "doctor") {
        res = await api.post("/auth/doctor/login", {
          doctor_id: form.doctor_id, clinic_id: form.clinic_id, password: form.password,
        });
      } else if (role === "admin") {
        res = await api.post("/auth/admin/login", { email: form.email, password: form.password });
      }

      if (res.data.otp_required) {
        setOtpChallenge(res.data);
        setOtp("");
        if (res.data.dev_otp) {
          showToast(`Dev mode — no SMS/email gateway configured. Your code is ${res.data.dev_otp}`, "success");
        }
      } else {
        completeLogin(res.data);
      }
    } catch (err) {
      showToast(err.response?.data?.error || "Login failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/auth/verify-otp", { pending_token: otpChallenge.pending_token, otp });
      completeLogin(res.data);
    } catch (err) {
      showToast(err.response?.data?.error || "Incorrect code", "error");
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    try {
      const res = await api.post("/auth/2fa/resend", { pending_token: otpChallenge.pending_token });
      showToast(res.data.dev_otp ? `New code: ${res.data.dev_otp}` : "A new code has been sent", "success");
    } catch (err) {
      showToast(err.response?.data?.error || "Could not resend code", "error");
    }
  };

  const handleGoogleSuccess = (data) => {
    if (data.otp_required) {
      setOtpChallenge(data);
      setOtp("");
      if (data.dev_otp) showToast(`Dev mode — your code is ${data.dev_otp}`, "success");
      return;
    }
    login("patient", data.token, data.patient);
    showToast("Welcome!", "success");
    navigate("/patient/dashboard");
  };

  return (
    <div className="auth-page">
      <div className="auth-top-bar" style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
        <LanguageSelector />
        <ThemeToggle compact />
      </div>
      <div className="auth-card">
        <h2>{t(COPY[role].titleKey)}</h2>

        {otpChallenge ? (
          <form onSubmit={verifyOtp}>
            <p>{t("login.verifyPrompt")}</p>
            {otpChallenge.dev_otp && (
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Dev mode (no SMS/email gateway configured): code is <strong>{otpChallenge.dev_otp}</strong>
              </p>
            )}
            <label>{t("login.verifyTitle")}</label>
            <input className="input" inputMode="numeric" maxLength={6} autoFocus
                   value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} required />
            <button className="btn" style={{ width: "100%" }} disabled={loading || otp.length !== 6}>
              {loading ? t("login.verifying") : t("login.verifyButton")}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
              <button type="button" className="btn secondary small" onClick={() => setOtpChallenge(null)}>{t("common.back")}</button>
              <button type="button" className="btn secondary small" onClick={resendOtp}>{t("login.resendCode")}</button>
            </div>
          </form>
        ) : (
        <form onSubmit={submit}>
          {role === "patient" && (
            <>
              <label>{t("login.emailLabel")}</label>
              <input className="input" type="email" value={form.email} onChange={set("email")} required />
              <label>{t("login.passwordLabel")}</label>
              <input className="input" type="password" value={form.password} onChange={set("password")} required />
            </>
          )}

          {role === "receptionist" && (
            <>
              <label>Receptionist ID</label>
              <input className="input" placeholder="REC-000001" value={form.receptionist_id} onChange={set("receptionist_id")} required />
              <label>Clinic/Hospital ID</label>
              <input className="input" placeholder="CLN-000001" value={form.clinic_id} onChange={set("clinic_id")} required />
              <label>{t("login.passwordLabel")}</label>
              <input className="input" type="password" value={form.password} onChange={set("password")} required />
            </>
          )}

          {role === "doctor" && (
            <>
              <label>Doctor ID</label>
              <input className="input" placeholder="DOC-000001" value={form.doctor_id} onChange={set("doctor_id")} required />
              <label>Clinic/Hospital ID</label>
              <input className="input" placeholder="CLN-000001 or HOS-000001" value={form.clinic_id} onChange={set("clinic_id")} required />
              <label>{t("login.passwordLabel")}</label>
              <input className="input" type="password" value={form.password} onChange={set("password")} required />
            </>
          )}

          {role === "admin" && (
            <>
              <label>{t("login.emailLabel")}</label>
              <input className="input" type="email" value={form.email} onChange={set("email")} required />
              <label>{t("login.passwordLabel")}</label>
              <input className="input" type="password" value={form.password} onChange={set("password")} required />
            </>
          )}

          <button className="btn" style={{ width: "100%" }} disabled={loading}>
            {loading ? t("login.signingIn") : t("login.loginButton")}
          </button>

          {role === "patient" && (
            <p style={{ textAlign: "center", fontSize: 12, margin: "12px 0 0" }}>
              <Link to="/patient/forgot-password">{t("login.forgotPassword")}</Link>
            </p>
          )}

          {role === "receptionist" && (
            <p style={{ textAlign: "center", fontSize: 12, margin: "12px 0 0", display: "flex", flexDirection: "column", gap: 4 }}>
              <Link to="/receptionist/forgot-password">{t("login.forgotPassword")}</Link>
              <span>
                <Link to="/receptionist/forgot-id">{t("login.forgotReceptionistId")}</Link>
                {" · "}
                <Link to="/receptionist/forgot-clinic-id">{t("login.forgotClinicId")}</Link>
              </span>
            </p>
          )}

          {role === "doctor" && (
            <p style={{ textAlign: "center", fontSize: 12, margin: "12px 0 0", display: "flex", flexDirection: "column", gap: 4 }}>
              <Link to="/doctor/forgot-password">{t("login.forgotPassword")}</Link>
              <span>
                <Link to="/doctor/forgot-id">{t("login.forgotDoctorId")}</Link>
                {" · "}
                <Link to="/doctor/forgot-clinic-id">{t("login.forgotClinicId")}</Link>
              </span>
            </p>
          )}
        </form>
        )}

        {!otpChallenge && role === "patient" && (
          <>
            <hr style={{ border: "none", borderTop: "1px solid var(--border, #2a2f3d)", margin: "18px 0" }} />
            <GoogleLoginButton
              onSuccess={handleGoogleSuccess}
              onError={(msg) => showToast(msg, "error")}
            />
            <p style={{ fontSize: 13, marginTop: 14 }}>
              {t("login.newPatient")} <Link to="/patient/register">{t("login.createAccount")}</Link>
            </p>
          </>
        )}
        {!otpChallenge && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 14 }}>{COPY[role].demo}</p>
        )}
      </div>
    </div>
  );
}