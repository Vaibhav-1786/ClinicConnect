import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useLanguage } from "../../context/LanguageContext";
import PatientJourneyTimeline from "../../components/PatientJourneyTimeline";
import PatientQueueStatus from "../../components/PatientQueueStatus";

export default function PatientDashboard() {
  const [data, setData] = useState({ requests: [], appointments: [] });
  const { t } = useLanguage();

  useEffect(() => {
    api.get("/appointments/patient").then((r) => setData(r.data));
  }, []);

  const upcoming = data.appointments.filter((a) => ["CONFIRMED", "CHECKED_IN"].includes(a.status));
  const pending = data.requests.filter((r) => ["PENDING", "UNDER_REVIEW"].includes(r.status));

  return (
    <DashboardLayout title={t("dashboard.patientTitle")}>
      <div className="grid grid-3">
        <div className="card stat-card"><div className="value">{upcoming.length}</div><div className="label">{t("dashboard.upcomingAppointments")}</div></div>
        <div className="card stat-card"><div className="value">{pending.length}</div><div className="label">{t("dashboard.pendingRequests")}</div></div>
        <div className="card stat-card"><div className="value">{data.appointments.filter(a=>a.status==='COMPLETED').length}</div><div className="label">{t("dashboard.pastVisits")}</div></div>
      </div>

      <PatientQueueStatus />

      <div className="card">
        <h3>{t("journey.ariaLabel")}</h3>
        <PatientJourneyTimeline useLatestForPatient compact />
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{t("dashboard.bookNewAppointment")}</h3>
          <Link to="/patient/clinics" className="btn">{t("nav.findClinic")}</Link>
        </div>
      </div>

      <div className="card">
        <h3>{t("dashboard.upcomingAppointments")}</h3>
        {upcoming.length === 0 ? <div className="empty-state">{t("dashboard.noUpcomingAppointments")}</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("dashboard.doctor")}</th><th>{t("dashboard.clinic")}</th><th>{t("common.date")}</th><th>{t("common.time")}</th><th>{t("common.status")}</th></tr></thead>
            <tbody>
              {upcoming.map((a) => (
                <tr key={a.id}>
                  <td>Dr. {a.doctor_name}</td><td>{a.clinic_name}</td>
                  <td>{a.appointment_date}</td><td>{String(a.appointment_time).slice(0,5)}</td>
                  <td><span className={`badge ${a.status}`}>{a.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h3>{t("dashboard.pendingRequests")}</h3>
        {pending.length === 0 ? <div className="empty-state">{t("dashboard.noPendingRequests")}</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("dashboard.doctor")}</th><th>{t("dashboard.clinic")}</th><th>{t("dashboard.requestedDate")}</th><th>{t("common.time")}</th><th>{t("common.status")}</th></tr></thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td>Dr. {r.doctor_name}</td><td>{r.clinic_name}</td>
                  <td>{r.requested_date}</td><td>{String(r.requested_time).slice(0,5)}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </DashboardLayout>
  );
}
