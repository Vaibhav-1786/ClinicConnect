import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import ProgressBar from "../../components/ProgressBar";
import AdminComments from "../../components/AdminComments";

export default function AdminClinicDetail() {
  const { id } = useParams();
  const [capacity, setCapacity] = useState(null);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => {
    api.get(`/admin/clinics/${id}/capacity`).then((r) => setCapacity(r.data)).catch((err) => {
      showToast(err.response?.data?.error || t("clinicDetail.loadFailed"), "error");
    });
  };
  useEffect(() => { load(); }, [id]);

  const snapshot = async () => {
    await api.post(`/admin/clinics/${id}/capacity/snapshot`);
    showToast(t("clinicDetail.snapshotSaved"), "success");
    load();
  };

  if (!capacity) return <DashboardLayout title={t("clinicDetail.title")}><p>{t("common.loading")}</p></DashboardLayout>;

  return (
    <DashboardLayout title={`${capacity.clinic_name} — ${t("clinicDetail.title")}`}>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{t("clinicDetail.liveCapacity")}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
          <div><p style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("clinicDetail.doctors")}</p><p style={{ fontSize: 22, fontWeight: 700 }}>{capacity.doctor_count}</p></div>
          <div><p style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("clinicDetail.departments")}</p><p style={{ fontSize: 22, fontWeight: 700 }}>{capacity.department_count}</p></div>
          <div><p style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("clinicDetail.todaysAppointments")}</p><p style={{ fontSize: 22, fontWeight: 700 }}>{capacity.appointments_count}</p></div>
          <div><p style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("clinicDetail.availableSlots")}</p><p style={{ fontSize: 22, fontWeight: 700 }}>{capacity.available_slots}</p></div>
        </div>
        <p style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t("clinicDetail.utilization")}</span>
          <strong>{capacity.utilization_pct}% — {t(`clinicDetail.level.${capacity.capacity_level}`)}</strong>
        </p>
        <ProgressBar pct={capacity.utilization_pct} level={capacity.capacity_level} height={16} />
        <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={snapshot}>{t("clinicDetail.saveSnapshot")}</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{t("clinicDetail.trend")}</h3>
        {(!capacity.trend || capacity.trend.length === 0) ? (
          <div className="empty-state">{t("clinicDetail.noTrend")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("common.date")}</th><th>{t("clinicDetail.utilization")}</th><th>{t("common.status")}</th></tr></thead>
            <tbody>
              {capacity.trend.map((row, i) => (
                <tr key={i}>
                  <td>{row.snapshot_date}</td>
                  <td>{row.utilization_pct}%</td>
                  <td><span className={`pill ${row.capacity_level === "CRITICAL" ? "pill-danger" : row.capacity_level === "HIGH" ? "pill-warning" : "pill-success"}`}>{t(`clinicDetail.level.${row.capacity_level}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <AdminComments entityType="CLINIC" entityId={id} />
    </DashboardLayout>
  );
}
