import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";

export default function ReceptionistLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/auth/receptionist/login", { email, password });
      login("receptionist", res.data.token, res.data.receptionist);
      showToast("Welcome back!", "success");
      navigate("/receptionist/dashboard");
    } catch (err) {
      showToast(err.response?.data?.error || "Login failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-tabs">
          <Link to="/patient/login">Patient</Link>
          <Link to="/receptionist/login" className="active">Receptionist</Link>
          <Link to="/doctor/login">Doctor</Link>
        </div>
        <h2>Receptionist Login</h2>
        <form onSubmit={submit}>
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn" style={{ width: "100%" }} disabled={loading}>
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 14 }}>Demo: receptionist@demo.com / Password123</p>
      </div>
    </div>
  );
}
