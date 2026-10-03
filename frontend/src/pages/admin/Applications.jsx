import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useLanguage } from "../../context/LanguageContext";

const STATUS_CLASS = { PENDING: "pill-warning", UNDER_REVIEW: "pill-warning", APPROVED: "pill-success", REJECTED: "pill-danger" };

export default function AdminApplications() {
  const [list, setList] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  const load = () => {
    setLoading(true);
    api.get("/admin/applications", { params: status ? { status } : {} })
      .then((r) => setList(r.data))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [status]);

  return (
    <DashboardLayout title={t("adminApps.title")}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <select className="input" style={{ width: "min(100%, 220px)", margin: 0 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("adminApps.allStatuses")}</option>
          <option value="PENDING">{t("recAppointments.pending")}</option>
          <option value="UNDER_REVIEW">{t("recAppointments.underReview")}</option>
          <option value="APPROVED">{t("recAppointments.approvedOpt")}</option>
          <option value="REJECTED">{t("recAppointments.rejectedOpt")}</option>
        </select>
        <Link className="btn" to="/admin/applications/new">+ {t("adminApps.newApplication")}</Link>
      </div>

      {loading ? <p>{t("common.loading")}</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("dashboard.doctor")}</th><th>{t("common.specialization")}</th><th>{t("dashboard.clinic")}</th><th>{t("common.status")}</th><th>{t("adminApps.submitted")}</th><th></th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td>{a.full_name}</td>
                <td>{a.specialization}</td>
                <td>{a.clinic_name || t("adminApps.existingOrg")}</td>
                <td><span className={`pill ${STATUS_CLASS[a.status]}`}>{a.status}</span></td>
                <td>{new Date(a.created_at).toLocaleDateString()}</td>
                <td><Link to={`/admin/applications/${a.id}`}>{t("adminApps.view")}</Link></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6}>{t("adminApps.empty")}</td></tr>}
          </tbody>
        </table></div>
      )}
    </DashboardLayout>
  );
}