import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import useOnlineStatus from "../../hooks/useOnlineStatus";
import { useLanguage } from "../../context/LanguageContext";
import TriageForm from "../../components/TriageForm";

const STATUS_FLOW = ["Waiting", "Called", "In Consultation", "Completed", "Cancelled", "No Show", "Skipped"];
const CATEGORY_PILL_CLASS = { normal: "pill-success", priority: "pill-warning", urgent: "pill-danger" };

export default function Queue() {
  const [summary, setSummary] = useState({ current: null, next: null, waiting: [], all: [] });
  const [loading, setLoading] = useState(true);
  const online = useOnlineStatus();
  const [doctors, setDoctors] = useState([]);
  const [checkinForm, setCheckinForm] = useState({ mode: "appointment", appointment_id: "", doctor_id: "", patient_id: "", walk_in_name: "", walk_in_phone: "" });
  const [todaysAppointments, setTodaysAppointments] = useState([]);
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [triageQueueId, setTriageQueueId] = useState(null);

  const load = () => {
    setLoading(true);
    api.get("/receptionist/queue/summary").then((r) => setSummary(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get("/appointments/receptionist/doctors").then((r) => setDoctors(r.data)).catch(() => {});
    api.get("/appointments/receptionist/appointments/today").then((r) => setTodaysAppointments(r.data)).catch(() => {});
  }, []);

  const checkIn = async () => {
    try {
      const payload = checkinForm.mode === "appointment"
        ? { appointment_id: Number(checkinForm.appointment_id) }
        : {
            doctor_id: Number(checkinForm.doctor_id),
            ...(checkinForm.patient_id ? { patient_id: Number(checkinForm.patient_id) } : { walk_in_name: checkinForm.walk_in_name, walk_in_phone: checkinForm.walk_in_phone }),
          };
      const res = await api.post("/opd/check-in", payload);
      showToast(t("recQueue.checkedIn").replace("{token}", res.data.token_number), "success");
      setCheckinForm({ mode: "appointment", appointment_id: "", doctor_id: "", patient_id: "", walk_in_name: "", walk_in_phone: "" });
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("recQueue.checkInFailed"), "error");
    }
  };

  const setStatus = async (id, status) => {
    try {
      await api.post(`/opd/queue/${id}/status`, { status });
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("docQueue.updateFailed"), "error");
    }
  };

  const statusBadgeClass = (s) => (
    s === "Completed" ? "COMPLETED" : s === "Cancelled" || s === "No Show" ? "CANCELLED" :
    s === "In Consultation" || s === "Called" ? "CONFIRMED" : "PENDING"
  );

  return (
    <DashboardLayout title={t("nav.queue")}>
      <div className="grid grid-3">
        <div className="card" style={{ textAlign: "center" }}>
          <h3>{t("recQueue.currentToken")}</h3>
          {summary.current ? (
            <>
              <div style={{ fontSize: 40, fontWeight: 700 }}>#{summary.current.token_number}</div>
              <p>{summary.current.patient_name} — Dr. {summary.current.doctor_name}</p>
            </>
          ) : <div className="empty-state">{t("recQueue.noOneBeingSeen")}</div>}
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <h3>{t("recQueue.nextToken")}</h3>
          {summary.next ? (
            <>
              <div style={{ fontSize: 40, fontWeight: 700 }}>#{summary.next.token_number}</div>
              <p>{summary.next.patient_name} — Dr. {summary.next.doctor_name}</p>
              <button className="btn small" disabled={!online} onClick={() => setStatus(summary.next.id, "Called")}>{t("recQueue.callNext")}</button>
            </>
          ) : <div className="empty-state">{t("recQueue.queueEmpty")}</div>}
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <h3>{t("recQueue.waitingPatients")}</h3>
          <div style={{ fontSize: 40, fontWeight: 700 }}>{summary.waiting.length}</div>
        </div>
      </div>

      <div className="card">
        <h3>{t("recQueue.checkIn")}</h3>
        <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="radio" checked={checkinForm.mode === "appointment"} onChange={() => setCheckinForm({ ...checkinForm, mode: "appointment" })} />
            {t("recQueue.prebookedAppointment")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="radio" checked={checkinForm.mode === "walkin"} onChange={() => setCheckinForm({ ...checkinForm, mode: "walkin" })} />
            {t("recQueue.walkIn")}
          </label>
        </div>

        {checkinForm.mode === "appointment" ? (
          <div className="grid grid-3">
            <div>
              <label>{t("recQueue.todaysAppointment")}</label>
              <select value={checkinForm.appointment_id} onChange={(e) => setCheckinForm({ ...checkinForm, appointment_id: e.target.value })}>
                <option value="">{t("recQueue.selectAppointment")}</option>
                {todaysAppointments.map((a) => (
                  <option key={a.id} value={a.id}>{a.patient_name} — Dr. {a.doctor_name} @ {String(a.appointment_time).slice(0,5)}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn small" disabled={!checkinForm.appointment_id || !online} onClick={checkIn}>{t("recQueue.checkIn")}</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-3">
            <div>
              <label>{t("dashboard.doctor")}</label>
              <select value={checkinForm.doctor_id} onChange={(e) => setCheckinForm({ ...checkinForm, doctor_id: e.target.value })}>
                <option value="">{t("recQueue.selectDoctor")}</option>
                {doctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.full_name}</option>)}
              </select>
            </div>
            <div>
              <label>{t("recQueue.registeredPatientId")}</label>
              <input className="input" placeholder={t("recQueue.leaveBlankUnregistered")} value={checkinForm.patient_id} onChange={(e) => setCheckinForm({ ...checkinForm, patient_id: e.target.value })} />
            </div>
            {!checkinForm.patient_id && (
              <>
                <div><label>{t("recQueue.patientName")}</label><input className="input" value={checkinForm.walk_in_name} onChange={(e) => setCheckinForm({ ...checkinForm, walk_in_name: e.target.value })} /></div>
                <div><label>{t("common.phone")}</label><input className="input" value={checkinForm.walk_in_phone} onChange={(e) => setCheckinForm({ ...checkinForm, walk_in_phone: e.target.value })} /></div>
              </>
            )}
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn small" onClick={checkIn} disabled={!online || !checkinForm.doctor_id || (!checkinForm.patient_id && !checkinForm.walk_in_name)}>{t("recQueue.generateToken")}</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>{t("nav.todaysQueue")}</h3>
        {loading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : summary.all.length === 0 ? (
          <div className="empty-state">{t("recQueue.noCheckinsToday")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("docQueue.token")}</th><th>{t("docQueue.patient")}</th><th>{t("dashboard.doctor")}</th><th>{t("docQueue.type")}</th><th>{t("recQueue.priority")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr></thead>
            <tbody>
              {summary.all.map((q) => (
                <tr key={q.id}>
                  <td>#{q.token_number}</td>
                  <td>{q.patient_name}</td>
                  <td>Dr. {q.doctor_name}</td>
                  <td><span className="pill">{q.visit_type}</span></td>
                  <td>{q.priority && q.priority !== "normal" ? <span className={`pill ${CATEGORY_PILL_CLASS[q.priority]}`}>{t(`triageForm.${q.priority}`)}</span> : "—"}</td>
                  <td><span className={`badge ${statusBadgeClass(q.status)}`}>{q.status}</span></td>
                  <td><div className="row-actions">
                    <select value={q.status} onChange={(e) => setStatus(q.id, e.target.value)} style={{ width: 150 }} disabled={!online}>
                      {STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {q.status === "Called" && (
                      <button className="btn small secondary" disabled={!online} onClick={() => setStatus(q.id, "Skipped")}>{t("recQueue.skip")}</button>
                    )}
                    {q.status === "Skipped" && (
                      <button className="btn small secondary" disabled={!online} onClick={() => setStatus(q.id, "Called")}>{t("recQueue.recall")}</button>
                    )}
                    {q.patient_id && (
                      <button className="btn small secondary" onClick={() => setTriageQueueId(triageQueueId === q.id ? null : q.id)}>{t("recQueue.triage")}</button>
                    )}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {triageQueueId && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h3>{t("triageForm.title")}</h3>
            <button className="btn small secondary" onClick={() => setTriageQueueId(null)}>×</button>
          </div>
          <TriageForm queueId={triageQueueId} onSaved={load} />
        </div>
      )}
    </DashboardLayout>
  );
}
