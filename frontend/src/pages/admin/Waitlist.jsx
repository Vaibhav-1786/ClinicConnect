import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useLanguage } from "../../context/LanguageContext";

export default function AdminWaitlist() {
  const [data, setData] = useState({ summary: [], recent: [] });
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => {
    api.get("/admin/waitlist").then((r) => setData(r.data)).finally(() => setLoading(false));
  }, []);

  const byClinic = {};
  data.summary.forEach((row) => {
    byClinic[row.clinic_name] = byClinic[row.clinic_name] || {};
    byClinic[row.clinic_name][row.status] = row.total;
  });

  return (
    <DashboardLayout title={t("nav.waitlistMonitor")}>
      <div className="card">
        <h3>{t("adminWaitlist.byClinic")}</h3>
        {loading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : Object.keys(byClinic).length === 0 ? (
          <div className="empty-state">{t("adminWaitlist.noActivity")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("dashboard.clinic")}</th><th>{t("adminWaitlist.waiting")}</th><th>{t("adminWaitlist.notified")}</th><th>{t("adminWaitlist.booked")}</th><th>{t("recAppointments.cancelledOpt")}</th><th>{t("adminWaitlist.expired")}</th></tr></thead>
            <tbody>
              {Object.entries(byClinic).map(([clinic, counts]) => (
                <tr key={clinic}>
                  <td>{clinic}</td>
                  <td>{counts.WAITING || 0}</td>
                  <td>{counts.NOTIFIED || 0}</td>
                  <td>{counts.BOOKED || 0}</td>
                  <td>{counts.CANCELLED || 0}</td>
                  <td>{counts.EXPIRED || 0}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h3>{t("adminWaitlist.recentActivity")}</h3>
        {data.recent.length === 0 ? (
          <div className="empty-state">{t("adminWaitlist.nothingToShow")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("docQueue.patient")}</th><th>{t("dashboard.doctor")}</th><th>{t("dashboard.clinic")}</th><th>{t("patWaitlist.preferredDate")}</th><th>{t("common.status")}</th><th>{t("recWaitlist.joined")}</th></tr></thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id}>
                  <td>{r.patient_name}</td>
                  <td>Dr. {r.doctor_name}</td>
                  <td>{r.clinic_name}</td>
                  <td>{r.preferred_date}</td>
                  <td><span className={`badge ${r.status === "NOTIFIED" ? "CONFIRMED" : r.status === "BOOKED" ? "COMPLETED" : r.status === "WAITING" ? "PENDING" : "CANCELLED"}`}>{r.status}</span></td>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </DashboardLayout>
  );
}
