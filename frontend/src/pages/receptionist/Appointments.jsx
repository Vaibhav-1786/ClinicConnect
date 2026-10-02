import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function ReceptionistAppointments() {
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState("");
  const [reviewing, setReviewing] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => {
    const q = filter ? `?status=${filter}` : "";
    api.get(`/appointments/receptionist${q}`).then((r) => setRequests(r.data));
  };
  useEffect(() => { load(); }, [filter]);

  const review = async (req) => {
    setReviewing(req);
    setAvailability(null);
    const res = await api.get(`/appointments/receptionist/${req.id}/check-availability`);
    setAvailability(res.data);
  };

  const approve = async (id) => {
    try {
      await api.post(`/appointments/${id}/approve`);
      showToast(t("recAppointments.approved"), "success");
      setReviewing(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("recAppointments.approveFailed"), "error");
    }
  };

  const reject = async (id) => {
    try {
      await api.post(`/appointments/${id}/reject`, { reason: rejectReason });
      showToast(t("recAppointments.rejected"), "success");
      setReviewing(null);
      setRejectReason("");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("recAppointments.rejectFailed"), "error");
    }
  };

  const reschedule = async (id) => {
    try {
      await api.post(`/appointments/${id}/reschedule`, { new_date: rescheduleDate, new_time: rescheduleTime });
      showToast(t("recAppointments.rescheduled"), "success");
      setReviewing(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("recAppointments.rescheduleFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("nav.appointmentRequests")}>
      <div className="card">
        <label>{t("recAppointments.filterByStatus")}</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">{t("recAppointments.all")}</option>
          <option value="PENDING">{t("recAppointments.pending")}</option>
          <option value="UNDER_REVIEW">{t("recAppointments.underReview")}</option>
          <option value="APPROVED">{t("recAppointments.approvedOpt")}</option>
          <option value="REJECTED">{t("recAppointments.rejectedOpt")}</option>
          <option value="RESCHEDULED">{t("recAppointments.rescheduledOpt")}</option>
          <option value="CANCELLED">{t("recAppointments.cancelledOpt")}</option>
        </select>
      </div>

      <div className="card">
        {requests.length === 0 ? <div className="empty-state">{t("recAppointments.noRequests")}</div> : (
          <div className="table-wrap"><table>
            <thead>
              <tr><th>{t("docQueue.patient")}</th><th>{t("dashboard.doctor")}</th><th>{t("dashboard.clinic")}</th><th>{t("patAppointments.requested")}</th><th>{t("docHistory.reason")}</th><th>{t("common.status")}</th><th>{t("recAppointments.appointmentId")}</th><th></th></tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.patient_name} <span style={{ color: "var(--text-muted)" }}>({r.patient_code})</span></td>
                  <td>Dr. {r.doctor_name}</td><td>{r.clinic_name}</td>
                  <td>{r.requested_date} {String(r.requested_time).slice(0,5)}</td>
                  <td style={{ maxWidth: 180 }}>{r.reason}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td>
                    {r.appointment_id ? (
                      <button
                        type="button"
                        className="btn small secondary"
                        title={t("recAppointments.copyIdTitle")}
                        onClick={() => {
                          navigator.clipboard.writeText(String(r.appointment_id));
                          showToast(t("recAppointments.idCopied").replace("{id}", r.appointment_id), "success");
                        }}
                      >
                        #{r.appointment_id} 📋
                      </button>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    )}
                  </td>
                  <td>
                    {["PENDING","UNDER_REVIEW"].includes(r.status) && (
                      <button className="btn small" onClick={() => review(r)}>{t("recAppointments.review")}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {reviewing && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h3>{t("recAppointments.reviewRequest")} #{reviewing.id} — {reviewing.patient_name}</h3>
            <button className="btn small secondary" onClick={() => setReviewing(null)}>{t("common.close")}</button>
          </div>
          <p>{t("dashboard.doctor")}: Dr. {reviewing.doctor_name} · {t("dashboard.clinic")}: {reviewing.clinic_name}</p>
          <p>{t("patAppointments.requested")}: {reviewing.requested_date} {t("recAppointments.at")} {String(reviewing.requested_time).slice(0,5)}</p>
          <p>{t("docHistory.reason")}: {reviewing.reason}</p>

          {availability && (
            <p>
              {t("recAppointments.slotStatus")}:{" "}
              {availability.requested_slot_available ? (
                <span className="badge approved">{t("patFindClinics.available")}</span>
              ) : (
                <span className="badge rejected">{t("recAppointments.notAvailable")}</span>
              )}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="btn success" disabled={availability && !availability.requested_slot_available}
                    onClick={() => approve(reviewing.id)}>{t("recAppointments.approve")}</button>
          </div>

          <hr style={{ margin: "16px 0", border: "none", borderTop: "1px solid var(--border)" }} />

          <h4>{t("recAppointments.reject")}</h4>
          <input className="input" placeholder={t("recAppointments.reasonForRejection")} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          <button className="btn danger" onClick={() => reject(reviewing.id)}>{t("recAppointments.rejectRequest")}</button>

          <hr style={{ margin: "16px 0", border: "none", borderTop: "1px solid var(--border)" }} />

          <h4>{t("recAppointments.suggestAnotherTime")}</h4>
          <div className="grid grid-2">
            <input type="date" className="input" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
            <input type="time" className="input" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} />
          </div>
          <button className="btn secondary" onClick={() => reschedule(reviewing.id)}>{t("recAppointments.reschedule")}</button>
        </div>
      )}
    </DashboardLayout>
  );
}
