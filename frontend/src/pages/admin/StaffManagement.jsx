import React, { useEffect, useState } from "react";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const STAFF_TYPES = ["nurse", "pharmacist", "lab_technician"];
const EMPTY_FORM = { staff_type: "nurse", full_name: "", phone: "", email: "", clinic_id: "", department: "", specialization: "", working_hours: "" };

export default function AdminStaffManagement() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [list, setList] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [filterType, setFilterType] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    api.get("/admin/staff", { params: filterType ? { staff_type: filterType } : {} }).then((r) => setList(r.data));
  };
  useEffect(() => { load(); }, [filterType]);
  useEffect(() => { api.get("/admin/clinics").then((r) => setClinics(r.data)); }, []);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const save = async () => {
    if (!form.full_name || !form.clinic_id) {
      showToast(t("adminStaff.missingFields"), "error");
      return;
    }
    try {
      await api.post("/admin/staff", form);
      showToast(t("adminStaff.added"), "success");
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("adminStaff.saveFailed"), "error");
    }
  };

  const toggleActive = async (s) => {
    if (s.is_active) {
      await api.delete(`/admin/staff/${s.id}`);
    } else {
      await api.put(`/admin/staff/${s.id}`, { is_active: 1 });
    }
    load();
  };

  return (
    <DashboardLayout title={t("nav.staffManagement")}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: "min(100%, 200px)" }}>
            <option value="">{t("adminStaff.allTypes")}</option>
            {STAFF_TYPES.map((ty) => <option key={ty} value={ty}>{t(`adminStaff.type.${ty}`)}</option>)}
          </select>
          <button className="btn small" onClick={() => setShowForm((s) => !s)}>
            {showForm ? t("common.close") : t("adminStaff.addStaff")}
          </button>
        </div>

        {showForm && (
          <div className="grid grid-3" style={{ marginTop: 14 }}>
            <div>
              <label>{t("adminStaff.staffType")}</label>
              <select value={form.staff_type} onChange={set("staff_type")}>
                {STAFF_TYPES.map((ty) => <option key={ty} value={ty}>{t(`adminStaff.type.${ty}`)}</option>)}
              </select>
            </div>
            <div><label>{t("common.name")}</label><input className="input" value={form.full_name} onChange={set("full_name")} /></div>
            <div>
              <label>{t("dashboard.clinic")}</label>
              <select value={form.clinic_id} onChange={set("clinic_id")}>
                <option value="">{t("adminStaff.selectClinic")}</option>
                {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label>{t("common.phone")}</label><input className="input" value={form.phone} onChange={set("phone")} /></div>
            <div><label>{t("common.email")}</label><input className="input" value={form.email} onChange={set("email")} /></div>
            <div><label>{t("adminStaff.department")}</label><input className="input" value={form.department} onChange={set("department")} /></div>
            <div><label>{t("common.specialization")}</label><input className="input" value={form.specialization} onChange={set("specialization")} /></div>
            <div><label>{t("adminStaff.workingHours")}</label><input className="input" placeholder="9:00 AM - 5:00 PM" value={form.working_hours} onChange={set("working_hours")} /></div>
            <div style={{ alignSelf: "end" }}><button className="btn small" onClick={save}>{t("common.save")}</button></div>
          </div>
        )}
      </div>

      <div className="card">
        {list.length === 0 ? <div className="empty-state">{t("adminStaff.empty")}</div> : (
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>{t("common.name")}</th><th>{t("adminStaff.staffType")}</th><th>{t("dashboard.clinic")}</th>
                <th>{t("adminStaff.department")}</th><th>{t("adminStaff.workingHours")}</th><th>{t("common.status")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>{s.full_name}</td>
                  <td><span className="pill">{t(`adminStaff.type.${s.staff_type}`)}</span></td>
                  <td>{s.clinic_name}</td>
                  <td>{s.department || "—"}</td>
                  <td>{s.working_hours || "—"}</td>
                  <td>{s.is_active ? <span className="pill pill-success">{t("docReceptionists.active")}</span> : <span className="pill pill-danger">{t("docReceptionists.inactive")}</span>}</td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => toggleActive(s)}>{s.is_active ? t("adminClinics.deactivate") : t("adminClinics.activate")}</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </DashboardLayout>
  );
}
