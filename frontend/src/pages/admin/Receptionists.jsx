import React, { useEffect, useState } from "react";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function AdminReceptionists() {
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const [accessPanel, setAccessPanel] = useState(null); // { receptionist, clinic_doctors, access_type, selected_doctor_ids, selected_departments }
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => api.get("/admin/receptionists", { params: search ? { search } : {} }).then((r) => setList(r.data));
  useEffect(() => { load(); }, []);

  const toggleActive = async (r) => {
    await api.post(`/admin/receptionists/${r.id}/status`, { is_active: !r.is_active });
    showToast(r.is_active ? t("adminReceptionists.deactivated") : t("adminReceptionists.activated"), "success");
    load();
  };

  const resetPassword = async (r) => {
    const res = await api.post(`/admin/receptionists/${r.id}/reset-password`);
    showToast(t("adminDoctors.newTempPassword").replace("{password}", res.data.temporary_password), "success");
  };

  const openAccess = async (r) => {
    const res = await api.get(`/admin/receptionist-access/${r.id}`);
    setAccessPanel({
      receptionistId: r.id,
      receptionistName: r.full_name,
      clinicDoctors: res.data.clinic_doctors,
      accessType: res.data.access_type,
      selectedDoctorIds: new Set(res.data.selected_doctor_ids),
      selectedDepartments: new Set(res.data.selected_departments),
    });
  };

  const toggleDoctor = (id) => {
    setAccessPanel((p) => {
      const next = new Set(p.selectedDoctorIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...p, selectedDoctorIds: next };
    });
  };

  const toggleDepartment = (dept) => {
    setAccessPanel((p) => {
      const next = new Set(p.selectedDepartments);
      next.has(dept) ? next.delete(dept) : next.add(dept);
      return { ...p, selectedDepartments: next };
    });
  };

  const saveAccess = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/receptionist-access/${accessPanel.receptionistId}`, {
        access_type: accessPanel.accessType,
        doctor_ids: [...accessPanel.selectedDoctorIds],
        departments: [...accessPanel.selectedDepartments],
      });
      showToast("Receptionist permissions saved", "success");
      setAccessPanel(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || "Failed to save permissions", "error");
    } finally {
      setSaving(false);
    }
  };

  const departmentOptions = accessPanel
    ? [...new Set(accessPanel.clinicDoctors.map((d) => d.department).filter(Boolean))]
    : [];

  return (
    <DashboardLayout title={t("nav.receptionists")}>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input className="input" style={{ margin: 0, width: "min(100%, 280px)" }} placeholder={t("adminReceptionists.searchPlaceholder")}
               value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-outline" onClick={load}>{t("common.search")}</button>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("adminReceptionists.receptionistId")}</th><th>{t("common.name")}</th><th>{t("dashboard.clinic")}</th><th>{t("adminReceptionists.addedBy")}</th><th>Access</th><th>{t("common.status")}</th><th></th></tr></thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td>{r.receptionist_code}</td>
              <td>{r.full_name}</td>
              <td>{r.clinic_name} ({r.clinic_code})</td>
              <td>{r.doctor_name ? `${r.doctor_name} (${r.doctor_code})` : t("adminReceptionists.adminAdded")}</td>
              <td>
                {r.access_type === "ALL" && <span className="pill">All doctors</span>}
                {r.access_type === "DEPARTMENT" && <span className="pill pill-success">By department</span>}
                {r.access_type === "SPECIFIC" && <span className="pill pill-success">Selected doctors</span>}
              </td>
              <td>{r.is_active ? <span className="pill pill-success">{t("docReceptionists.active")}</span> : <span className="pill pill-danger">{t("docReceptionists.inactive")}</span>}</td>
              <td><div className="row-actions">
                <button className="btn btn-outline btn-sm" onClick={() => openAccess(r)}>Manage Access</button>
                <button className="btn btn-outline btn-sm" onClick={() => toggleActive(r)}>{r.is_active ? t("adminClinics.deactivate") : t("adminClinics.activate")}</button>
                <button className="btn btn-outline btn-sm" onClick={() => resetPassword(r)}>{t("adminDoctors.resetPassword")}</button>
              </div></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={7}>{t("adminReceptionists.empty")}</td></tr>}
        </tbody>
      </table></div>

      {accessPanel && (
        <div className="card" style={{ marginTop: 16, maxWidth: 640 }}>
          <h3>Doctor Access — {accessPanel.receptionistName}</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            A large hospital doesn't need one receptionist per doctor. Choose whether this
            receptionist can manage every doctor in the hospital, only certain departments,
            or a hand-picked list of doctors. Enforced on every appointment action, not just here.
          </p>

          <label><input type="radio" checked={accessPanel.accessType === "ALL"} onChange={() => setAccessPanel({ ...accessPanel, accessType: "ALL" })} /> All doctors in this hospital/clinic</label><br />
          <label><input type="radio" checked={accessPanel.accessType === "DEPARTMENT"} onChange={() => setAccessPanel({ ...accessPanel, accessType: "DEPARTMENT" })} /> By department</label><br />
          <label><input type="radio" checked={accessPanel.accessType === "SPECIFIC"} onChange={() => setAccessPanel({ ...accessPanel, accessType: "SPECIFIC" })} /> Selected doctors only</label>

          {accessPanel.accessType === "DEPARTMENT" && (
            <div style={{ marginTop: 12 }}>
              <label>Departments</label>
              {departmentOptions.length === 0 && <div className="empty-state">No doctors in this clinic have a department set yet.</div>}
              {departmentOptions.map((dept) => (
                <div key={dept}>
                  <label>
                    <input type="checkbox" checked={accessPanel.selectedDepartments.has(dept)} onChange={() => toggleDepartment(dept)} /> {dept}
                  </label>
                </div>
              ))}
            </div>
          )}

          {accessPanel.accessType === "SPECIFIC" && (
            <div style={{ marginTop: 12 }}>
              <label>Select Doctors</label>
              {accessPanel.clinicDoctors.map((d) => (
                <div key={d.id}>
                  <label>
                    <input type="checkbox" checked={accessPanel.selectedDoctorIds.has(d.id)} onChange={() => toggleDoctor(d.id)} /> Dr. {d.full_name} {d.specialization ? `(${d.specialization})` : ""}
                  </label>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button className="btn" disabled={saving} onClick={saveAccess}>{saving ? "Saving..." : "Save Permissions"}</button>
            <button className="btn btn-outline" onClick={() => setAccessPanel(null)}>{t("common.cancel")}</button>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}