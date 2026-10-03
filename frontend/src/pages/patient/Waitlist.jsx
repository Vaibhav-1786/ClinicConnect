import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function Waitlist() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => {
    setLoading(true);
    api.get("/patient/waitlist").then((r) => setEntries(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const cancel = async (e) => {
    if (!window.confirm(t("patWaitlist.confirmLeave"))) return;
    try {
      await api.post(`/patient/waitlist/${e.id}/cancel`);
      showToast(t("patWaitlist.removed"), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("patWaitlist.cancelFailed"), "error");
    }
  };

  const claim = async (e) => {
    try {
      const res = await api.post(`/patient/waitlist/${e.id}/claim`);
      showToast(t("patWaitlist.slotBooked", "Slot booked!").replace("{id}", res.data.appointment_id), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("patWaitlist.claimFailed"), "error");
      load();
    }
  };

  return (
    <DashboardLayout title={t("nav.waitlist")}>
      <div className="card">
        <h3>{t("patWaitlist.title")}</h3>
        <p style={{ color: "var(--text-muted)" }}>{t("patWaitlist.hint")}</p>
        {loading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">{t("patWaitlist.empty")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("dashboard.doctor")}</th><th>{t("dashboard.clinic")}</th><th>{t("patWaitlist.for")}</th><th>{t("patWaitlist.preferredDate")}</th><th>{t("patWaitlist.timeWindow")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>Dr. {e.doctor_name}</td>
                  <td>{e.clinic_name}</td>
                  <td>{e.family_member_name || t("patWaitlist.myself")}</td>
                  <td>{e.preferred_date}</td>
                  <td>{String(e.preferred_time_start).slice(0,5)} - {String(e.preferred_time_end).slice(0,5)}</td>
                  <td>
                    <span className={`badge ${e.status === "NOTIFIED" ? "CONFIRMED" : e.status === "BOOKED" ? "COMPLETED" : e.status === "WAITING" ? "PENDING" : "CANCELLED"}`}>
                      {e.status}
                    </span>
                  </td>
                  <td>
                    {e.status === "NOTIFIED" && (
                      <button className="btn small" onClick={() => claim(e)}>{t("patWaitlist.claimSlot")}</button>
                    )}
                    {["WAITING", "NOTIFIED"].includes(e.status) && (
                      <button className="btn small danger" style={{ marginLeft: 6 }} onClick={() => cancel(e)}>{t("patWaitlist.leaveWaitlist")}</button>
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
