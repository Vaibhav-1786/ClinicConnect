import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const RELATIONSHIPS = ["Self", "Child", "Parent", "Grandparent", "Spouse", "Sibling", "Other"];
const EMPTY_FORM = {
  full_name: "", dob: "", gender: "", relationship: "Child", mobile_number: "",
  address: "", blood_group: "", allergies: "", emergency_contact: "",
};

export default function Family() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null); // null = hidden, object = add/edit form
  const [editingId, setEditingId] = useState(null);
  const [viewing, setViewing] = useState(null);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const load = () => {
    setLoading(true);
    api.get("/patient/family").then((r) => setMembers(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const startAdd = () => { setForm({ ...EMPTY_FORM }); setEditingId(null); setViewing(null); };
  const startEdit = (m) => {
    setForm({
      full_name: m.full_name, dob: m.dob || "", gender: m.gender || "",
      relationship: m.relationship, mobile_number: m.mobile_number || "",
      address: m.address || "", blood_group: m.blood_group || "",
      allergies: m.allergies || "", emergency_contact: m.emergency_contact || "",
    });
    setEditingId(m.id);
    setViewing(null);
  };

  const save = async () => {
    try {
      if (editingId) {
        await api.put(`/patient/family/${editingId}`, form);
        showToast(t("patFamily.updated"), "success");
      } else {
        await api.post("/patient/family", form);
        showToast(t("patFamily.added"), "success");
      }
      setForm(null);
      setEditingId(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("patFamily.saveFailed"), "error");
    }
  };

  const remove = async (m) => {
    if (!window.confirm(t("patFamily.confirmRemove").replace("{name}", m.full_name))) return;
    try {
      await api.delete(`/patient/family/${m.id}`);
      showToast(t("patFamily.removed"), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("patFamily.removeFailed"), "error");
    }
  };

  const bookFor = (m) => {
    navigate("/patient/clinics", { state: { bookingForFamilyMember: m } });
  };

  return (
    <DashboardLayout title={t("nav.family")}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>{t("patFamily.manage")}</h3>
          <button className="btn small" onClick={startAdd}>+ {t("patFamily.addMember")}</button>
        </div>

        {loading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : members.length === 0 ? (
          <div className="empty-state">{t("patFamily.empty")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("common.name")}</th><th>{t("patFamily.relationship")}</th><th>{t("patFamily.dob")}</th><th>{t("patFamily.gender")}</th><th>{t("patFamily.mobile")}</th><th>{t("common.actions")}</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.full_name}</td>
                  <td><span className="pill">{m.relationship}</span></td>
                  <td>{m.dob || "—"}</td>
                  <td>{m.gender || "—"}</td>
                  <td>{m.mobile_number || "—"}</td>
                  <td>
                    <button className="btn small secondary" onClick={() => setViewing(m)}>{t("patFamily.view")}</button>
                    <button className="btn small secondary" style={{ marginLeft: 6 }} onClick={() => startEdit(m)}>{t("common.edit")}</button>
                    <button className="btn small" style={{ marginLeft: 6 }} onClick={() => bookFor(m)}>{t("patFamily.bookAppointment")}</button>
                    <button className="btn small danger" style={{ marginLeft: 6 }} onClick={() => remove(m)}>{t("common.delete")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {viewing && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h3>{t("patFamily.profileOf").replace("{name}", viewing.full_name)}</h3>
            <button className="btn small secondary" onClick={() => setViewing(null)}>{t("common.close")}</button>
          </div>
          <div className="grid grid-3">
            <div><label>{t("patFamily.relationship")}</label><p>{viewing.relationship}</p></div>
            <div><label>{t("patFamily.dobFull")}</label><p>{viewing.dob || t("patFamily.notSet")}</p></div>
            <div><label>{t("patFamily.gender")}</label><p>{viewing.gender || t("patFamily.notSet")}</p></div>
            <div><label>{t("patFamily.mobileFull")}</label><p>{viewing.mobile_number || t("patFamily.notSet")}</p></div>
            <div><label>{t("patFamily.bloodGroup")}</label><p>{viewing.blood_group || t("patFamily.notSet")}</p></div>
            <div><label>{t("patFamily.emergencyContact")}</label><p>{viewing.emergency_contact || t("patFamily.notSet")}</p></div>
          </div>
          <label>{t("patFamily.address")}</label><p>{viewing.address || t("patFamily.notSet")}</p>
          <label>{t("patFamily.allergies")}</label><p>{viewing.allergies || t("patFamily.noneRecorded")}</p>
        </div>
      )}

      {form && (
        <div className="card">
          <h3>{editingId ? t("patFamily.editMember") : t("patFamily.addMember")}</h3>
          <div className="grid grid-3">
            <div>
              <label>{t("common.name")} *</label>
              <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div>
              <label>{t("patFamily.relationship")} *</label>
              <select value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}>
                {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label>{t("patFamily.dobFull")}</label>
              <input type="date" className="input" max={new Date().toISOString().slice(0, 10)}
                     value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
            </div>
            <div>
              <label>{t("patFamily.gender")}</label>
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">{t("patFamily.select")}</option>
                <option value="Male">{t("patFamily.male")}</option>
                <option value="Female">{t("patFamily.female")}</option>
                <option value="Other">{t("patFamily.other")}</option>
              </select>
            </div>
            <div>
              <label>{t("patFamily.mobileFull")}</label>
              <input className="input" value={form.mobile_number} onChange={(e) => setForm({ ...form, mobile_number: e.target.value })} />
            </div>
            <div>
              <label>{t("patFamily.bloodGroup")}</label>
              <input className="input" placeholder="e.g. O+" value={form.blood_group} onChange={(e) => setForm({ ...form, blood_group: e.target.value })} />
            </div>
            <div>
              <label>{t("patFamily.emergencyContact")}</label>
              <input className="input" value={form.emergency_contact} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} />
            </div>
          </div>
          <label>{t("patFamily.address")}</label>
          <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <label>{t("patFamily.allergies")}</label>
          <textarea rows={2} value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} placeholder="e.g. Penicillin, peanuts" />

          <button className="btn" onClick={save}>{editingId ? t("patFamily.saveChanges") : t("patFamily.addMember")}</button>
          <button className="btn secondary" style={{ marginLeft: 8 }} onClick={() => { setForm(null); setEditingId(null); }}>{t("common.cancel")}</button>
        </div>
      )}
    </DashboardLayout>
  );
}
