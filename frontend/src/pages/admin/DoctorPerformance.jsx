import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useLanguage } from "../../context/LanguageContext";

export default function DoctorPerformance() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const { t } = useLanguage();

  useEffect(() => {
    setLoading(true);
    api.get("/admin/analytics/doctors").then((r) => setList(r.data)).finally(() => setLoading(false));
  }, []);

  const openDetail = async (doctorId) => {
    const res = await api.get(`/admin/analytics/doctors/${doctorId}`);
    setDetail(res.data);
  };

  return (
    <DashboardLayout title={t("adminPerf.title")}>
      <div className="card">
        <p style={{ color: "var(--text-muted)" }}>{t("adminPerf.hint")}</p>
        {loading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>{t("dashboard.doctor")}</th><th>{t("common.specialization")}</th><th>{t("adminPerf.total")}</th><th>{t("dashboard.completed")}</th>
                <th>{t("adminPerf.cancellationRate")}</th><th>{t("adminPerf.noShowRate")}</th><th>{t("adminPerf.avgRating")}</th><th>{t("adminPerf.orgs")}</th><th>{t("common.status")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td>Dr. {d.full_name} <span style={{ color: "var(--text-muted)" }}>({d.doctor_code})</span></td>
                  <td>{d.specialization}</td>
                  <td>{d.total_appointments}</td>
                  <td>{d.completed}</td>
                  <td>{d.cancellation_rate}%</td>
                  <td>{d.no_show_rate}%</td>
                  <td>{d.avg_rating !== null ? `⭐ ${d.avg_rating}` : "—"}</td>
                  <td>{d.active_organizations}</td>
                  <td><span className={`badge ${d.verification_status === "APPROVED" ? "CONFIRMED" : "PENDING"}`}>{d.verification_status}</span></td>
                  <td><button className="btn small secondary" onClick={() => openDetail(d.id)}>{t("adminPerf.details")}</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {detail && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h3>{t("adminPerf.performanceDetail").replace("{name}", detail.doctor.full_name)}</h3>
            <button className="btn small secondary" onClick={() => setDetail(null)}>{t("common.close")}</button>
          </div>
          <div className="grid grid-3">
            <div><label>{t("adminPerf.totalAppointments")}</label><p>{detail.stats.total_appointments}</p></div>
            <div><label>{t("dashboard.completed")}</label><p>{detail.stats.completed}</p></div>
            <div><label>{t("adminPerf.cancellationRate")}</label><p>{detail.stats.cancellation_rate}%</p></div>
            <div><label>{t("adminPerf.noShowRate")}</label><p>{detail.stats.no_show_rate}%</p></div>
            <div>
              <label>{t("adminPerf.avgConsultDuration")}</label>
              <p>{detail.avg_consultation_minutes !== null
                ? t("adminPerf.minFromVisits").replace("{min}", detail.avg_consultation_minutes).replace("{n}", detail.consultation_duration_sample_size)
                : t("adminPerf.notEnoughData")}</p>
            </div>
            <div><label>{t("adminPerf.patientRating")}</label><p>{detail.avg_rating !== null ? `⭐ ${detail.avg_rating} (${detail.total_reviews} ${t("adminPerf.reviews")})` : t("adminPerf.noReviews")}</p></div>
          </div>
          <label>{t("adminPerf.activeOrgs")}</label>
          <ul>
            {detail.organizations.map((o) => (
              <li key={o.id}>{o.name} ({o.org_type}) — {o.status}</li>
            ))}
          </ul>
        </div>
      )}
    </DashboardLayout>
  );
}
