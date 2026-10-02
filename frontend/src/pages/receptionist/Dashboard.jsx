import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useLanguage } from "../../context/LanguageContext";

export default function ReceptionistDashboard() {
  const [stats, setStats] = useState(null);
  const { t } = useLanguage();

  useEffect(() => { api.get("/reports/receptionist/summary").then((r) => setStats(r.data)); }, []);

  return (
    <DashboardLayout title={t("dashboard.receptionistTitle")}>
      <div className="grid grid-4">
        <div className="card stat-card"><div className="value">{stats?.total_patients ?? "-"}</div><div className="label">{t("dashboard.totalPatients")}</div></div>
        <div className="card stat-card"><div className="value">{stats?.todays_appointments ?? "-"}</div><div className="label">{t("dashboard.todaysAppointments")}</div></div>
        <div className="card stat-card"><div className="value">{stats?.pending_requests ?? "-"}</div><div className="label">{t("dashboard.pendingRequests")}</div></div>
        <div className="card stat-card"><div className="value">₹{stats?.todays_revenue ?? "-"}</div><div className="label">{t("dashboard.todaysRevenue")}</div></div>
      </div>
      <div className="card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Link to="/receptionist/appointments" className="btn">{t("dashboard.manageAppointmentRequests")}</Link>
          <Link to="/receptionist/patients" className="btn secondary">{t("dashboard.registerSearchPatients")}</Link>
          <Link to="/receptionist/billing" className="btn secondary">{t("nav.billing")}</Link>
        </div>
      </div>
    </DashboardLayout>
  );
}
