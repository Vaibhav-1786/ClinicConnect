import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function RecurringAppointments() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [occurrences, setOccurrences] = useState([]);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => {
    setLoading(true);
    api.get("/patient/recurring-appointments").then((r) => setPlans(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const viewOccurrences = async (plan) => {
    if (expanded === plan.id) { setExpanded(null); return; }
    const res = await api.get(`/patient/recurring-appointments/${plan.id}/occurrences`);
    setOccurrences(res.data);
    setExpanded(plan.id);
  };

  const act = async (plan, action) => {
    try {
      await api.post(`/patient/recurring-appointments/${plan.id}/${action}`);
      showToast(t(`patRecurring.${action}Done`), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t(`patRecurring.${action}Failed`), "error");
    }
  };

  return (
    <DashboardLayout title={t("nav.recurringAppointments")}>
      <div className="card">
        <h3>{t("patRecurring.yourSchedules")}</h3>
        <p style={{ color: "var(--text-muted)" }}>{t("patRecurring.hint")}</p>
        {loading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : plans.length === 0 ? (
          <div className="empty-state">{t("patRecurring.empty")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("dashboard.doctor")}</th><th>{t("dashboard.clinic")}</th><th>{t("patWaitlist.for")}</th><th>{t("patRecurring.frequency")}</th><th>{t("patRecurring.visits")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr></thead>
            <tbody>
              {plans.map((p) => (
                <React.Fragment key={p.id}>
                  <tr>
                    <td>Dr. {p.doctor_name}</td>
                    <td>{p.clinic_name}</td>
                    <td>{p.family_member_name || t("patWaitlist.myself")}</td>
                    <td>{p.frequency}</td>
                    <td>{p.occurrence_count}</td>
                    <td><span className={`badge ${p.status === "ACTIVE" ? "CONFIRMED" : p.status === "PAUSED" ? "PENDING" : "CANCELLED"}`}>{p.status}</span></td>
                    <td>
                      <button className="btn small secondary" onClick={() => viewOccurrences(p)}>
                        {expanded === p.id ? t("patRecurring.hide") : t("patRecurring.view")} {t("patRecurring.visitsWord")}
                      </button>
                      {p.status === "ACTIVE" && (
                        <button className="btn small secondary" style={{ marginLeft: 6 }} onClick={() => act(p, "pause")}>{t("patRecurring.pause")}</button>
                      )}
                      {p.status === "PAUSED" && (
                        <button className="btn small secondary" style={{ marginLeft: 6 }} onClick={() => act(p, "resume")}>{t("patRecurring.resume")}</button>
                      )}
                      {["ACTIVE", "PAUSED"].includes(p.status) && (
                        <button className="btn small danger" style={{ marginLeft: 6 }} onClick={() => act(p, "cancel")}>{t("patAppointments.cancel")}</button>
                      )}
                    </td>
                  </tr>
                  {expanded === p.id && (
                    <tr>
                      <td colSpan={7}>
                        <table>
                          <thead><tr><th>{t("common.date")}</th><th>{t("common.time")}</th><th>{t("common.status")}</th><th>{t("patRecurring.requestStatus")}</th></tr></thead>
                          <tbody>
                            {occurrences.map((o) => (
                              <tr key={o.id}>
                                <td>{o.occurrence_date}</td>
                                <td>{String(o.occurrence_time).slice(0,5)}</td>
                                <td><span className="badge CONFIRMED">{o.status}</span></td>
                                <td>{o.request_status || "—"}{o.failure_reason ? ` (${o.failure_reason})` : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </DashboardLayout>
  );
}
