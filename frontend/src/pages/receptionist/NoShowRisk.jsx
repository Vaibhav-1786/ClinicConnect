import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useLanguage } from "../../context/LanguageContext";

export default function NoShowRisk() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => {
    setLoading(true);
    api.get(`/appointments/no-show-risk?date=${date}`).then((r) => setRows(r.data)).finally(() => setLoading(false));
  }, [date]);

  return (
    <DashboardLayout title={t("recNoShowRisk.title")}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>{t("recNoShowRisk.heading")}</h3>
          <input type="date" className="input" style={{ width: "min(100%, 180px)", margin: 0 }} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <p style={{ color: "var(--text-muted)" }}>{t("recNoShowRisk.intro")}</p>

        {loading ? (
          <div className="empty-state">{t("recNoShowRisk.loading")}</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">{t("recNoShowRisk.empty")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr>
              <th>{t("recNoShowRisk.colTime")}</th><th>{t("recNoShowRisk.colPatient")}</th><th>{t("recNoShowRisk.colDoctor")}</th>
              <th>{t("recNoShowRisk.colPastAppointments")}</th><th>{t("recNoShowRisk.colPastNoShows")}</th><th>{t("recNoShowRisk.colRisk")}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.high_risk ? { background: "var(--badge-pending-bg, #fef3c7)" } : {}}>
                  <td>{r.appointment_time}</td>
                  <td>{r.patient_name} ({r.patient_code})</td>
                  <td>{r.doctor_name}</td>
                  <td>{r.past_appointments}</td>
                  <td>{r.past_no_shows}</td>
                  <td>
                    {r.high_risk
                      ? <span className="badge REJECTED">{t("recNoShowRisk.high")} ({Math.round(r.no_show_rate * 100)}%)</span>
                      : <span className="badge CONFIRMED">{t("recNoShowRisk.low")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </DashboardLayout>
  );
}
