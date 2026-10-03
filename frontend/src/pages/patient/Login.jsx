import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";

export default function PatientLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cityId, setCityId] = useState("");
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/locations/cities/all").then((r) => setCities(r.data)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!cityId) {
      showToast("Please select your city/location", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post("/auth/patient/login", { email, password, city_id: cityId });
      login("patient", res.data.token, res.data.patient);
      showToast("Welcome back!", "success");
      navigate("/patient/dashboard");
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
          <Link to="/patient/login" className="active">Patient</Link>
          <Link to="/receptionist/login">Receptionist</Link>
          <Link to="/doctor/login">Doctor</Link>
        </div>
        <h2>Patient Login</h2>
        <form onSubmit={submit}>
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <label>City / Location</label>
          <select className="input" value={cityId} onChange={(e) => setCityId(e.target.value)} required>
            <option value="">Select City</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.state_name ? `, ${c.state_name}` : ""}</option>
            ))}
          </select>
          <button className="btn" style={{ width: "100%" }} disabled={loading}>
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>
        <p style={{ fontSize: 13, marginTop: 14 }}>
          New patient? <Link to="/patient/register">Create an account</Link>
        </p>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Demo: patient@demo.com / Password123</p>
      </div>
    </div>
  );
}
