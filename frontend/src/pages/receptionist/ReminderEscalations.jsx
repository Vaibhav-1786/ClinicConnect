import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function ReminderEscalations() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => {
    setLoading(true);
    api.get("/reminder-escalation/tasks").then((r) => setTasks(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const updateStatus = async (task, status) => {
    try {
      await api.post(`/reminder-escalation/tasks/${task.id}/status`, { status });
      showToast(t("recReminderEscalation.markedAs").replace("{status}", status.toLowerCase()), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("recReminderEscalation.updateFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("recReminderEscalation.title")}>
      <div className="card">
        <h3>{t("recReminderEscalation.heading")}</h3>
        <p style={{ color: "var(--text-muted)" }}>{t("recReminderEscalation.intro")}</p>

        {loading ? (
          <div className="empty-state">{t("recReminderEscalation.loading")}</div>
        ) : tasks.length === 0 ? (
          <div className="empty-state">{t("recReminderEscalation.empty")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr>
              <th>{t("recReminderEscalation.colPatient")}</th><th>{t("recReminderEscalation.colContact")}</th>
              <th>{t("recReminderEscalation.colReason")}</th><th>{t("recReminderEscalation.colStatus")}</th>
              <th>{t("recReminderEscalation.colActions")}</th>
            </tr></thead>
            <tbody>
              {tasks.map((t2) => (
                <tr key={t2.id}>
                  <td>{t2.patient_name} ({t2.patient_code})</td>
                  <td>{t2.emergency_contact ? <a href={`tel:${t2.emergency_contact}`}>{t2.emergency_contact}</a> : t2.patient_email}</td>
                  <td>{t2.reason}</td>
                  <td><span className={`badge ${t2.status === "OPEN" ? "PENDING" : "CONFIRMED"}`}>{t2.status}</span></td>
                  <td>
                    {t2.status === "OPEN" && (
                      <button className="btn small secondary" onClick={() => updateStatus(t2, "CALLED")}>{t("recReminderEscalation.markCalled")}</button>
                    )}
                    <button className="btn small" style={{ marginLeft: 6 }} onClick={() => updateStatus(t2, "RESOLVED")}>{t("recReminderEscalation.resolve")}</button>
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
