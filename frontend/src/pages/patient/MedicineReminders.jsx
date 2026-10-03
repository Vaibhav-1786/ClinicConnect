import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

function ReminderRow({ r, onMark, t }) {
  return (
    <tr>
      <td>{String(r.reminder_time).slice(0, 5)}</td>
      <td>{r.medicine_name} <span style={{ color: "var(--text-muted)" }}>({r.dosage})</span></td>
      <td>{r.instructions || r.before_after_food}</td>
      <td>Dr. {r.doctor_name}</td>
      <td>
        {r.status === "PENDING" || r.status === "MISSED" ? (
          <>
            <button className="btn small" onClick={() => onMark(r.id, "TAKEN")}>{t("patMedicine.markTaken")}</button>
            <button className="btn small secondary" style={{ marginLeft: 6 }} onClick={() => onMark(r.id, "SKIPPED")}>{t("patMedicine.skip")}</button>
          </>
        ) : (
          <span className={`badge ${r.status === "TAKEN" ? "CONFIRMED" : "CANCELLED"}`}>{r.status}</span>
        )}
      </td>
    </tr>
  );
}

export default function MedicineReminders() {
  const [buckets, setBuckets] = useState({ today: [], upcoming: [], completed: [], missed: [] });
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const SECTIONS = [
    { key: "today", label: t("patMedicine.today") },
    { key: "upcoming", label: t("patMedicine.upcoming") },
    { key: "completed", label: t("dashboard.completed") },
    { key: "missed", label: t("patMedicine.missed") },
  ];

  const load = () => {
    setLoading(true);
    api.get("/patient/medicine-reminders").then((r) => setBuckets(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const mark = async (id, status) => {
    try {
      await api.post(`/patient/medicine-reminders/${id}/mark`, { status });
      showToast(status === "TAKEN" ? t("patMedicine.markedTaken") : t("patMedicine.markedSkipped"), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("patMedicine.updateFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("nav.medicineReminders")}>
      <div className="card">
        <p style={{ color: "var(--text-muted)" }}>{t("patMedicine.hint")}</p>
      </div>
      {loading ? (
        <div className="card"><div className="empty-state">{t("common.loading")}</div></div>
      ) : (
        SECTIONS.map((s) => (
          <div className="card" key={s.key}>
            <h3>{s.label} ({buckets[s.key]?.length || 0})</h3>
            {(!buckets[s.key] || buckets[s.key].length === 0) ? (
              <div className="empty-state">{t("patMedicine.nothingHere")}</div>
            ) : (
              <div className="table-wrap"><table>
                <thead><tr><th>{t("common.time")}</th><th>{t("patMedicine.medicine")}</th><th>{t("patMedicine.instructions")}</th><th>{t("patMedicine.prescribedBy")}</th><th>{t("common.actions")}</th></tr></thead>
                <tbody>
                  {buckets[s.key].map((r) => <ReminderRow key={r.id} r={r} onMark={mark} t={t} />)}
                </tbody>
              </table></div>
            )}
          </div>
        ))
      )}
    </DashboardLayout>
  );
}
