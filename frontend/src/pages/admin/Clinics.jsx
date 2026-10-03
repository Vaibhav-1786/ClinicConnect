import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function AdminClinics() {
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => api.get("/admin/clinics", { params: search ? { search } : {} }).then((r) => setList(r.data));
  useEffect(() => { load(); }, []);

  const setStatus = async (clinic, status) => {
    await api.post(`/admin/clinics/${clinic.id}/status`, { status });
    showToast(status === "active" ? t("adminClinics.activated") : t("adminClinics.deactivated"), "success");
    load();
  };

  const setApproval = async (clinic, decision) => {
    if (decision === "REJECTED") {
      const reason = window.prompt(t("adminClinics.rejectionReason"));
      if (!reason) return;
      await api.post(`/admin/clinics/${clinic.id}/approval`, { decision, reason });
    } else {
      await api.post(`/admin/clinics/${clinic.id}/approval`, { decision });
    }
    showToast(decision === "APPROVED" ? t("adminClinics.approvedToast") : t("adminClinics.rejectedToast"), "success");
    load();
  };

  return (
    <DashboardLayout title={t("nav.clinics")}>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input className="input" style={{ margin: 0, width: "min(100%, 280px)" }} placeholder={t("adminClinics.searchPlaceholder")}
               value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-outline" onClick={load}>{t("common.search")}</button>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("adminClinics.code")}</th><th>{t("common.name")}</th><th>{t("docQueue.type")}</th><th>{t("adminClinics.approval")}</th><th>{t("common.status")}</th><th></th></tr></thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <td>{c.clinic_code}</td>
              <td>{c.name}</td>
              <td>{c.org_type}</td>
              <td>
                <span className={`pill ${c.approval_status === "APPROVED" ? "pill-success" : c.approval_status === "REJECTED" ? "pill-danger" : "pill-warning"}`}>
                  {c.approval_status}
                </span>
              </td>
              <td>{c.status === "active" ? <span className="pill pill-success">{t("docReceptionists.active")}</span> : <span className="pill pill-danger">{t("docReceptionists.inactive")}</span>}</td>
              <td><div className="row-actions">
                <Link className="btn btn-outline btn-sm" to={`/admin/clinics/${c.id}`}>{t("common.view")}</Link>
                {c.approval_status !== "APPROVED" && <button className="btn btn-outline btn-sm" onClick={() => setApproval(c, "APPROVED")}>{t("recAppointments.approve")}</button>}
                {c.approval_status !== "REJECTED" && <button className="btn btn-outline btn-sm" onClick={() => setApproval(c, "REJECTED")}>{t("recAppointments.reject")}</button>}
                <button className="btn btn-outline btn-sm" onClick={() => setStatus(c, c.status === "active" ? "inactive" : "active")}>
                  {c.status === "active" ? t("adminClinics.deactivate") : t("adminClinics.activate")}
                </button>
              </div></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={6}>{t("adminClinics.empty")}</td></tr>}
        </tbody>
      </table></div>
    </DashboardLayout>
  );
}