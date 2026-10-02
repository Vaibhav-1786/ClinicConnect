import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const STATUS_FILTERS = ["", "WAITING", "NOTIFIED", "BOOKED", "CANCELLED", "EXPIRED"];

export default function Waitlist() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => {
    setLoading(true);
    const qs = status ? `?status=${status}` : "";
    api.get(`/receptionist/waitlist${qs}`).then((r) => setEntries(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [status]);

  const notify = async (e) => {
    try {
      await api.post(`/receptionist/waitlist/${e.id}/notify`);
      showToast(t("recWaitlist.notified").replace("{name}", e.patient_name), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("recWaitlist.notifyFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("recWaitlist.title")}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>{t("recWaitlist.clinicWaitlist")}</h3>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "min(100%, 200px)" }}>
            {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s || t("recAppointments.all")}</option>)}
          </select>
        </div>
        <p style={{ color: "var(--text-muted)" }}>{t("recWaitlist.hint")}</p>
        {loading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">{status ? t("recWaitlist.emptyWithStatus").replace("{status}", status) : t("recWaitlist.empty")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("docQueue.patient")}</th><th>{t("patWaitlist.for")}</th><th>{t("dashboard.doctor")}</th><th>{t("patWaitlist.preferredDate")}</th><th>{t("patWaitlist.timeWindow")}</th><th>{t("common.status")}</th><th>{t("recWaitlist.joined")}</th><th>{t("common.actions")}</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.patient_name} <span style={{ color: "var(--text-muted)" }}>({e.patient_code})</span></td>
                  <td>{e.family_member_name || t("recWaitlist.self")}</td>
                  <td>Dr. {e.doctor_name}</td>
                  <td>{e.preferred_date}</td>
                  <td>{String(e.preferred_time_start).slice(0,5)} - {String(e.preferred_time_end).slice(0,5)}</td>
                  <td>
                    <span className={`badge ${e.status === "NOTIFIED" ? "CONFIRMED" : e.status === "BOOKED" ? "COMPLETED" : e.status === "WAITING" ? "PENDING" : "CANCELLED"}`}>
                      {e.status}
                    </span>
                  </td>
                  <td>{new Date(e.created_at).toLocaleDateString()}</td>
                  <td>
                    {e.status === "WAITING" && (
                      <button className="btn small" onClick={() => notify(e)}>{t("recWaitlist.notify")}</button>
                    )}
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
