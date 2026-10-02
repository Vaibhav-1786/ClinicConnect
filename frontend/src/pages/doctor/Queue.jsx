import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";

const CATEGORY_PILL_CLASS = { normal: "pill-success", priority: "pill-warning", urgent: "pill-danger" };
const PRIORITY_RANK = { urgent: 0, priority: 1, normal: 2 };

export default function Queue() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const { clinic } = useAuth();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => {
    setLoading(true);
    api.get(`/opd/queue${clinic?.id ? `?clinic_id=${clinic.id}` : ""}`)
      .then((r) => {
        const sorted = [...r.data].sort((a, b) => {
          const rankDiff = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
          return rankDiff !== 0 ? rankDiff : a.token_number - b.token_number;
        });
        setQueue(sorted);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [clinic?.id]);

  const setStatus = async (id, status) => {
    try {
      await api.post(`/opd/queue/${id}/status`, { status });
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("docQueue.updateFailed"), "error");
    }
  };

  const badgeClass = (s) => (
    s === "Completed" ? "COMPLETED" : s === "Cancelled" || s === "No Show" ? "CANCELLED" :
    s === "In Consultation" || s === "Called" ? "CONFIRMED" : "PENDING"
  );

  return (
    <DashboardLayout title={t("nav.todaysQueue")}>
      <div className="card">
        <p style={{ color: "var(--text-muted)" }}>{t("docQueue.hint").replace("{clinic}", clinic?.name || t("docQueue.thisOrganization"))}</p>
        {loading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : queue.length === 0 ? (
          <div className="empty-state">{t("docQueue.empty")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("docQueue.token")}</th><th>{t("docQueue.patient")}</th><th>{t("docQueue.type")}</th><th>{t("recQueue.priority")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr></thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.id}>
                  <td>#{q.token_number}</td>
                  <td>{q.patient_name}</td>
                  <td><span className="pill">{q.visit_type}</span></td>
                  <td>{q.priority && q.priority !== "normal" ? <span className={`pill ${CATEGORY_PILL_CLASS[q.priority]}`}>{t(`triageForm.${q.priority}`)}</span> : "—"}</td>
                  <td><span className={`badge ${badgeClass(q.status)}`}>{q.status}</span></td>
                  <td>
                    {q.status === "Waiting" && <button className="btn small" onClick={() => setStatus(q.id, "Called")}>{t("docQueue.call")}</button>}
                    {q.status === "Called" && <button className="btn small" onClick={() => setStatus(q.id, "In Consultation")}>{t("docQueue.startConsultation")}</button>}
                    {q.status === "In Consultation" && <button className="btn small" onClick={() => setStatus(q.id, "Completed")}>{t("docQueue.markCompleted")}</button>}
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
