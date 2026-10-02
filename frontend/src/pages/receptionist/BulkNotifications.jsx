import React, { useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function BulkNotifications() {
  const [category, setCategory] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [customMessage, setCustomMessage] = useState("");
  const { showToast } = useToast();
  const { t } = useLanguage();

  const CATEGORIES = [
    { key: "today", label: t("recBulk.todaysAppointments") },
    { key: "tomorrow", label: t("recBulk.tomorrowsAppointments") },
    { key: "pending", label: t("recBulk.pendingConfirmations") },
    { key: "cancelled", label: t("recBulk.cancelledToday") },
    { key: "rescheduled", label: t("recBulk.rescheduledToday") },
  ];

  const loadCategory = async (cat) => {
    setCategory(cat);
    setSelected(new Set());
    setConfirming(false);
    setLoading(true);
    try {
      const res = await api.get(`/receptionist/notifications/candidates?category=${cat}`);
      setCandidates(res.data.candidates);
    } catch (err) {
      showToast(err.response?.data?.error || t("recBulk.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    setSelected(selected.size === candidates.length ? new Set() : new Set(candidates.map((c) => c.id)));
  };

  const send = async () => {
    try {
      const res = await api.post("/receptionist/notifications/bulk-send", {
        category, appointment_ids: Array.from(selected), message: customMessage.trim() || undefined,
      });
      showToast(t("recBulk.sentTo").replace("{count}", res.data.sent), "success");
      setConfirming(false);
      setSelected(new Set());
      setCustomMessage("");
    } catch (err) {
      showToast(err.response?.data?.error || t("recBulk.sendFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("nav.bulkNotifications")}>
      <div className="card">
        <h3>{t("recBulk.selectCategory")}</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CATEGORIES.map((c) => (
            <button key={c.key} className={`btn small ${category === c.key ? "" : "secondary"}`} onClick={() => loadCategory(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {category && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>{t("recBulk.recipients")} — {CATEGORIES.find((c) => c.key === category)?.label}</h3>
            {candidates.length > 0 && (
              <button className="btn small secondary" onClick={toggleAll}>
                {selected.size === candidates.length ? t("recBulk.deselectAll") : t("recBulk.selectAll")}
              </button>
            )}
          </div>

          {loading ? (
            <div className="empty-state">{t("common.loading")}</div>
          ) : candidates.length === 0 ? (
            <div className="empty-state">{t("recBulk.noMatching")}</div>
          ) : (
            <>
              <div className="table-wrap"><table>
                <thead><tr><th></th><th>{t("docQueue.patient")}</th><th>{t("dashboard.doctor")}</th><th>{t("common.date")}</th><th>{t("common.time")}</th></tr></thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.id}>
                      <td><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                      <td>{c.patient_name}</td>
                      <td>Dr. {c.doctor_name}</td>
                      <td>{c.appointment_date}</td>
                      <td>{c.appointment_time ? String(c.appointment_time).slice(0,5) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>

              <label>{t("recBulk.customMessage")}</label>
              <textarea rows={2} value={customMessage} onChange={(e) => setCustomMessage(e.target.value)} />

              {!confirming ? (
                <button className="btn" disabled={selected.size === 0} onClick={() => setConfirming(true)}>
                  {t("recBulk.sendToPatients").replace("{count}", selected.size)}
                </button>
              ) : (
                <div className="card" style={{ background: "var(--badge-pending-bg)", marginTop: 10 }}>
                  <p>{t("recBulk.confirmSend").replace("{count}", selected.size)}</p>
                  <button className="btn" onClick={send}>{t("recBulk.yesSendNow")}</button>
                  <button className="btn secondary" style={{ marginLeft: 8 }} onClick={() => setConfirming(false)}>{t("common.cancel")}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
