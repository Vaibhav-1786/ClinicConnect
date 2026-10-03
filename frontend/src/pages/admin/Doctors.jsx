import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function AdminDoctors() {
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => api.get("/admin/doctors", { params: search ? { search } : {} }).then((r) => setList(r.data));
  useEffect(() => { load(); }, []);

  const toggleActive = async (doc) => {
    await api.post(`/admin/doctors/${doc.id}/status`, { is_active: !doc.is_active });
    showToast(doc.is_active ? t("adminDoctors.deactivated") : t("adminDoctors.activated"), "success");
    load();
  };

  const resetPassword = async (doc) => {
    const res = await api.post(`/admin/doctors/${doc.id}/reset-password`);
    showToast(t("adminDoctors.newTempPassword").replace("{password}", res.data.temporary_password), "success");
  };

  return (
    <DashboardLayout title={t("nav.doctors")}>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input className="input" style={{ margin: 0, width: "min(100%, 280px)" }} placeholder={t("adminDoctors.searchPlaceholder")}
               value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-outline" onClick={load}>{t("common.search")}</button>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("adminDoctors.doctorId")}</th><th>{t("common.name")}</th><th>{t("common.specialization")}</th><th>{t("adminExpiry.verification")}</th><th>{t("adminDoctors.active")}</th><th>{t("nav.clinics")}</th><th></th></tr></thead>
        <tbody>
          {list.map((d) => (
            <tr key={d.id}>
              <td>{d.doctor_code}</td>
              <td>{d.full_name}</td>
              <td>{d.specialization}</td>
              <td><span className={`pill ${d.verification_status === "APPROVED" ? "pill-success" : "pill-warning"}`}>{d.verification_status}</span></td>
              <td>{d.is_active ? <span className="pill pill-success">{t("docReceptionists.active")}</span> : <span className="pill pill-danger">{t("docReceptionists.inactive")}</span>}</td>
              <td>{(d.clinics || []).map((c) => c.clinic_code).join(", ") || "—"}</td>
              <td><div className="row-actions">
                <Link className="btn btn-outline btn-sm" to={`/admin/doctors/${d.id}`}>{t("common.view")}</Link>
                <button className="btn btn-outline btn-sm" onClick={() => toggleActive(d)}>{d.is_active ? t("adminClinics.deactivate") : t("adminClinics.activate")}</button>
                <button className="btn btn-outline btn-sm" onClick={() => resetPassword(d)}>{t("adminDoctors.resetPassword")}</button>
              </div></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={7}>{t("adminDoctors.empty")}</td></tr>}
        </tbody>
      </table></div>
    </DashboardLayout>
  );
}