import React, { useEffect, useState } from "react";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const empty = {
  full_name: "", mobile: "", email: "", address: "", gender: "Female",
  dob: "", joining_date: "", emergency_contact: "", notes: "",
};

export default function DoctorReceptionists() {
  const { clinic } = useAuth();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [list, setList] = useState([]);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get("/doctor/receptionists").then((r) => setList(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post("/doctor/receptionists", form);
      setCredentials(res.data.credentials);
      setForm(empty);
      setShowForm(false);
      load();
      showToast(t("docReceptionists.created"), "success");
    } catch (err) {
      showToast(err.response?.data?.error || t("docReceptionists.createFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("nav.receptionists")}>
      <p style={{ color: "var(--text-muted)", marginBottom: 10 }}>
        {t("docReceptionists.hint")} <strong>{clinic?.name} ({clinic?.clinic_code})</strong> — {t("docReceptionists.hintSuffix")}
      </p>

      {credentials && (
        <div className="card" style={{ background: "var(--badge-approved-bg)", borderColor: "var(--success)", marginBottom: 16 }}>
          <h3>{t("docReceptionists.credentialsTitle")}</h3>
          <p>{t("docReceptionists.receptionistId")}: <strong>{credentials.receptionist_code}</strong></p>
          <p>{t("docReceptionists.clinicId")}: <strong>{credentials.clinic_code}</strong></p>
          <p>{t("docReceptionists.tempPassword")}: <strong>{credentials.temporary_password}</strong></p>
          <button className="btn" onClick={() => setCredentials(null)}>{t("common.close")}</button>
        </div>
      )}

      <button className="btn" onClick={() => setShowForm((s) => !s)} style={{ marginBottom: 16 }}>
        {showForm ? t("common.cancel") : `+ ${t("docReceptionists.addReceptionist")}`}
      </button>

      {showForm && (
        <form onSubmit={submit} className="card" style={{ marginBottom: 20 }}>
          <div className="form-grid">
            <div><label>{t("patProfile.fullName")}</label><input className="input" value={form.full_name} onChange={set("full_name")} required /></div>
            <div><label>{t("common.phone")}</label><input className="input" value={form.mobile} onChange={set("mobile")} required /></div>
            <div><label>{t("common.email")}</label><input className="input" type="email" value={form.email} onChange={set("email")} required /></div>
            <div><label>{t("patFamily.gender")}</label>
              <select className="input" value={form.gender} onChange={set("gender")}>
                <option>Female</option><option>Male</option><option>Other</option>
              </select>
            </div>
            <div><label>{t("patFamily.dobFull")}</label><input className="input" type="date" value={form.dob} onChange={set("dob")} /></div>
            <div><label>{t("docReceptionists.joiningDate")}</label><input className="input" type="date" value={form.joining_date} onChange={set("joining_date")} /></div>
            <div><label>{t("patFamily.address")}</label><input className="input" value={form.address} onChange={set("address")} /></div>
            <div><label>{t("patFamily.emergencyContact")}</label><input className="input" value={form.emergency_contact} onChange={set("emergency_contact")} /></div>
          </div>
          <label>{t("docReceptionists.notes")}</label>
          <textarea className="input" value={form.notes} onChange={set("notes")} />
          <button className="btn" type="submit">{t("docReceptionists.createReceptionist")}</button>
        </form>
      )}

      {loading ? <p>{t("common.loading")}</p> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>ID</th><th>{t("common.name")}</th><th>{t("common.phone")}</th><th>{t("docReceptionists.joined")}</th><th>{t("common.status")}</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td>{r.receptionist_code}</td>
                <td>{r.full_name}</td>
                <td>{r.mobile}</td>
                <td>{r.joining_date || "-"}</td>
                <td>{r.is_active ? <span className="pill pill-success">{t("docReceptionists.active")}</span> : <span className="pill pill-danger">{t("docReceptionists.inactive")}</span>}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5}>{t("docReceptionists.empty")}</td></tr>}
          </tbody>
        </table></div>
      )}
    </DashboardLayout>
  );
}