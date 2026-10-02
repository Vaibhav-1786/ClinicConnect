import React, { useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function ReceptionistPatients() {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", mobile: "", password: "", dob: "", gender: "Female", blood_group: "" });
  const { showToast } = useToast();
  const { t } = useLanguage();

  const doSearch = async (q) => {
    setSearch(q);
    const res = await api.get(`/receptionist/patients?search=${encodeURIComponent(q)}`);
    setResults(res.data);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post("/receptionist/patients", form);
      showToast(t("recPatients.registered").replace("{code}", res.data.patient_code), "success");
      setShowForm(false);
      setForm({ full_name: "", email: "", mobile: "", password: "", dob: "", gender: "Female", blood_group: "" });
      doSearch(search);
    } catch (err) {
      showToast(err.response?.data?.error || t("recPatients.registrationFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("nav.patients")}>
      <div className="card">
        <div style={{ display: "flex", gap: 10 }}>
          <input className="input" style={{ marginBottom: 0 }} placeholder={t("recPatients.searchPlaceholder")}
                 value={search} onChange={(e) => doSearch(e.target.value)} />
          <button className="btn" onClick={() => setShowForm(!showForm)}>{showForm ? t("common.cancel") : `+ ${t("recPatients.registerPatient")}`}</button>
        </div>
      </div>

      {showForm && (
        <div className="card">
          <form onSubmit={submit}>
            <div className="grid grid-2">
              <div><label>{t("patProfile.fullName")}</label><input className="input" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><label>{t("patFamily.mobileFull")}</label><input className="input" required value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
            </div>
            <div className="grid grid-2">
              <div><label>{t("common.email")}</label><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><label>{t("recPatients.tempPassword")}</label><input className="input" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            </div>
            <div className="grid grid-3">
              <div><label>{t("patFamily.dob")}</label><input className="input" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></div>
              <div><label>{t("patFamily.gender")}</label>
                <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option>Female</option><option>Male</option><option>Other</option>
                </select>
              </div>
              <div><label>{t("patFamily.bloodGroup")}</label><input className="input" value={form.blood_group} onChange={(e) => setForm({ ...form, blood_group: e.target.value })} /></div>
            </div>
            <button className="btn">{t("recPatients.registerPatient")}</button>
          </form>
        </div>
      )}

      <div className="card">
        {results.length === 0 ? <div className="empty-state">{t("recPatients.searchHint")}</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("recPatients.patientId")}</th><th>{t("common.name")}</th><th>{t("common.phone")}</th><th>{t("common.email")}</th></tr></thead>
            <tbody>
              {results.map((p) => (
                <tr key={p.id}><td>{p.patient_code}</td><td>{p.full_name}</td><td>{p.phone}</td><td>{p.email}</td></tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </DashboardLayout>
  );
}
