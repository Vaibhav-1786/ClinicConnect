import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useLanguage } from "../../context/LanguageContext";

const CARD_KEYS = {
  total_doctors: "dashboard.totalDoctors",
  total_clinics: "dashboard.totalClinics",
  total_hospitals: "dashboard.totalHospitals",
  total_receptionists: "dashboard.totalReceptionists",
  total_patients: "dashboard.totalPatients",
  total_appointments: "dashboard.totalAppointments",
  pending_applications: "dashboard.pendingApplications",
  active_doctors: "dashboard.activeDoctors",
  active_clinics: "dashboard.activeClinicsHospitals",
};

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const { t } = useLanguage();

  useEffect(() => {
    api.get("/admin/dashboard/stats").then((r) => setData(r.data));
    api.get("/admin/command-center/summary").then((r) => setSummary(r.data)).catch(() => {});
  }, []);

  if (!data) return <DashboardLayout title={t("dashboard.adminTitle")}><p>{t("common.loading")}</p></DashboardLayout>;

  return (
    <DashboardLayout title={t("dashboard.adminTitle")}>
      {summary && (
        <div className="card" style={{ marginBottom: 16, background: "var(--info-soft)", color: "var(--info-soft-text)" }}>
          <h3>{t("commandCenter.goodMorning")}</h3>
          <p style={{ fontSize: 22, fontWeight: 700 }}>
            {t("commandCenter.actionsRequired").replace("{n}", summary.action_required_count)}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <Link className="btn btn-sm" to="/admin/alerts">{t("commandCenter.viewActionRequired")}</Link>
            <Link className="btn btn-outline btn-sm" to="/admin/applications/new">{t("commandCenter.addDoctor")}</Link>
            <Link className="btn btn-outline btn-sm" to="/admin/applications">{t("commandCenter.reviewApplications")}</Link>
            <Link className="btn btn-outline btn-sm" to="/admin/map">{t("nav.healthcareMap")}</Link>
            <Link className="btn btn-outline btn-sm" to="/admin/ai-assistant">{t("nav.aiAssistant")}</Link>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
            <span>🔴 {summary.counts.pending_applications} {t("commandCenter.pendingApplications")}</span>
            <span>🟠 {summary.counts.documents_expiring_soon} {t("commandCenter.documentsExpiring")}</span>
            <span>🟠 {summary.counts.clinics_pending_verification} {t("commandCenter.clinicsNeedVerification")}</span>
            <span>🟢 {summary.counts.doctors_approved_today} {t("commandCenter.doctorsApprovedToday")}</span>
          </div>
        </div>
      )}

      <div className="stat-cards">
        {Object.entries(CARD_KEYS).map(([key, labelKey]) => (
          <div key={key} className="card">
            <div className="stat-value">{data.cards[key]}</div>
            <div className="stat-label">{t(labelKey)}</div>
          </div>
        ))}
      </div>

      <div className="section-title">
        {t("dashboard.pendingVerificationRequests")}
        <Link to="/admin/applications" style={{ float: "right", fontSize: 13 }}>{t("dashboard.viewAll")}</Link>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("dashboard.doctor")}</th><th>{t("dashboard.clinic")}/Hospital</th><th>{t("common.status")}</th><th>{t("dashboard.submitted")}</th><th></th></tr></thead>
        <tbody>
          {data.pending_verification_requests.map((a) => (
            <tr key={a.id}>
              <td>{a.full_name}</td>
              <td>{a.clinic_name || "—"}</td>
              <td><span className="pill pill-warning">{a.status}</span></td>
              <td>{new Date(a.created_at).toLocaleDateString()}</td>
              <td><Link to={`/admin/applications/${a.id}`}>{t("dashboard.review")}</Link></td>
            </tr>
          ))}
          {data.pending_verification_requests.length === 0 && <tr><td colSpan={5}>{t("dashboard.noPendingApplications")}</td></tr>}
        </tbody>
      </table></div>

      <div className="section-title">{t("dashboard.recentDoctorRegistrations")}</div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("dashboard.doctor")} ID</th><th>{t("common.name")}</th><th>{t("dashboard.specialization")}</th><th>{t("common.status")}</th></tr></thead>
        <tbody>
          {data.recent_doctor_registrations.map((d) => (
            <tr key={d.id}>
              <td>{d.doctor_code}</td><td>{d.full_name}</td><td>{d.specialization}</td>
              <td><span className={`pill ${d.verification_status === "APPROVED" ? "pill-success" : "pill-warning"}`}>{d.verification_status}</span></td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <div className="section-title">{t("dashboard.recentlyApprovedClinics")}</div>
      <div className="table-wrap"><table>
        <thead><tr><th>Code</th><th>{t("common.name")}</th><th>Type</th></tr></thead>
        <tbody>
          {data.recently_approved_clinics.map((c) => (
            <tr key={c.id}><td>{c.clinic_code}</td><td>{c.name}</td><td>{c.org_type}</td></tr>
          ))}
        </tbody>
      </table></div>

      <div className="section-title">{t("dashboard.appointmentStatistics")}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {data.appointment_stats.map((s) => (
          <span key={s.status} className="pill">{s.status}: {s.c}</span>
        ))}
      </div>
    </DashboardLayout>
  );
}