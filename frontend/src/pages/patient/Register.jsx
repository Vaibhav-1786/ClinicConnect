import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function PatientRegister() {
  const [form, setForm] = useState({
    full_name: "", dob: "", gender: "Female", mobile: "", email: "", password: "",
    address: "", state_id: "", city_id: "", area_id: "", blood_group: "", allergies: "",
    emergency_contact: "",
  });
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => { api.get("/locations/states").then((r) => setStates(r.data)); }, []);
  useEffect(() => {
    if (form.state_id) api.get(`/locations/cities?state_id=${form.state_id}`).then((r) => setCities(r.data));
    else setCities([]);
  }, [form.state_id]);
  useEffect(() => {
    if (form.city_id) api.get(`/locations/areas?city_id=${form.city_id}`).then((r) => setAreas(r.data));
    else setAreas([]);
  }, [form.city_id]);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/auth/patient/register", form);
      login("patient", res.data.token, { full_name: form.full_name });
      showToast(t("patRegister.registered").replace("{code}", res.data.patient_code), "success");
      navigate("/patient/dashboard");
    } catch (err) {
      showToast(err.response?.data?.error || t("patRegister.failed"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card auth-card-wide">
        <h2>{t("patRegister.title")}</h2>
        <form onSubmit={submit}>
          <label>{t("patProfile.fullName")}</label>
          <input className="input" value={form.full_name} onChange={update("full_name")} required />
          <div className="grid grid-2">
            <div><label>{t("patFamily.dobFull")}</label><input className="input" type="date" value={form.dob} onChange={update("dob")} /></div>
            <div><label>{t("patFamily.gender")}</label>
              <select value={form.gender} onChange={update("gender")}>
                <option>Female</option><option>Male</option><option>Other</option>
              </select>
            </div>
          </div>
          <div className="grid grid-2">
            <div><label>{t("patFamily.mobileFull")}</label><input className="input" value={form.mobile} onChange={update("mobile")} required /></div>
            <div><label>{t("common.email")}</label><input className="input" type="email" value={form.email} onChange={update("email")} required /></div>
          </div>
          <label>{t("login.passwordLabel")}</label>
          <input className="input" type="password" value={form.password} onChange={update("password")} required />
          <label>{t("patFamily.address")}</label>
          <input className="input" value={form.address} onChange={update("address")} />
          <div className="grid grid-3">
            <div><label>{t("patRegister.state")}</label>
              <select value={form.state_id} onChange={update("state_id")}>
                <option value="">{t("patFamily.select")}</option>
                {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div><label>{t("patRegister.city")}</label>
              <select value={form.city_id} onChange={update("city_id")}>
                <option value="">{t("patFamily.select")}</option>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label>{t("patRegister.area")}</label>
              <select value={form.area_id} onChange={update("area_id")}>
                <option value="">{t("patFamily.select")}</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-2">
            <div><label>{t("patFamily.bloodGroup")}</label><input className="input" value={form.blood_group} onChange={update("blood_group")} placeholder="O+" /></div>
            <div><label>{t("patFamily.emergencyContact")}</label><input className="input" value={form.emergency_contact} onChange={update("emergency_contact")} /></div>
          </div>
          <label>{t("patFamily.allergies")}</label>
          <input className="input" value={form.allergies} onChange={update("allergies")} placeholder="None" />
          <button className="btn" style={{ width: "100%" }} disabled={loading}>
            {loading ? t("patRegister.creating") : t("patRegister.register")}
          </button>
        </form>
        <p style={{ fontSize: 13, marginTop: 14 }}>{t("patRegister.haveAccount")} <Link to="/patient/login">{t("login.loginButton")}</Link></p>
      </div>
    </div>
  );
}
