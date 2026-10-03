import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import VoiceRecorderButton from "../../components/VoiceRecorderButton";
import AudioMessagePlayer from "../../components/AudioMessagePlayer";

export default function PatientAppointments() {
  const [data, setData] = useState({ requests: [], appointments: [] });
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgText, setMsgText] = useState("");
  const [feedbackFor, setFeedbackFor] = useState(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const load = () => api.get("/appointments/patient").then((r) => setData(r.data));
  useEffect(() => { load(); }, []);

  const openChat = async (appt) => {
    setActiveChat(appt);
    const res = await api.get(`/messages/${appt.id}`);
    setMessages(res.data);
  };

  const sendMessage = async () => {
    if (!msgText.trim()) return;
    await api.post("/messages", { appointment_id: activeChat.id, message: msgText });
    setMsgText("");
    const res = await api.get(`/messages/${activeChat.id}`);
    setMessages(res.data);
  };

  const submitFeedback = async () => {
    try {
      await api.post("/feedback", { appointment_id: feedbackFor.id, rating, comment });
      showToast(t("patAppointments.feedbackThanks"), "success");
      setFeedbackFor(null);
      setComment("");
    } catch (err) {
      showToast(err.response?.data?.error || t("patAppointments.feedbackFailed"), "error");
    }
  };

  const cancelRequest = async (id) => {
    await api.post(`/appointments/${id}/cancel`);
    showToast(t("patAppointments.requestCancelled"), "success");
    load();
  };

  return (
    <DashboardLayout title={t("nav.myAppointments")}>
      <div className="card">
        <h3>{t("patAppointments.confirmedPast")}</h3>
        {data.appointments.length === 0 ? <div className="empty-state">{t("patAppointments.noneYet")}</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("dashboard.doctor")}</th><th>{t("dashboard.clinic")}</th><th>{t("common.date")}</th><th>{t("common.time")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr></thead>
            <tbody>
              {data.appointments.map((a) => (
                <tr key={a.id}>
                  <td>Dr. {a.doctor_name}</td><td>{a.clinic_name}</td>
                  <td>{a.appointment_date}</td><td>{String(a.appointment_time).slice(0,5)}</td>
                  <td><span className={`badge ${a.status}`}>{a.status}</span></td>
                  <td>
                    {a.consultation_mode === "ONLINE" && ["CONFIRMED","CHECKED_IN","IN_CONSULTATION"].includes(a.status) && (
                      <button className="btn small" onClick={() => navigate(`/patient/video-consultation/${a.id}`)}>{t("patAppointments.joinVideoCall")}</button>
                    )}
                    {["CONFIRMED","CHECKED_IN","IN_CONSULTATION","COMPLETED"].includes(a.status) && (
                      <button className="btn small secondary" style={{ marginLeft: 6 }} onClick={() => openChat(a)}>{t("patAppointments.messageDoctor")}</button>
                    )}
                    {a.status === "COMPLETED" && (
                      <button className="btn small" style={{ marginLeft: 6 }} onClick={() => setFeedbackFor(a)}>{t("patAppointments.feedback")}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h3>{t("patAppointments.pendingUnderReview")}</h3>
        {data.requests.filter(r => ["PENDING","UNDER_REVIEW","RESCHEDULED"].includes(r.status)).length === 0 ? (
          <div className="empty-state">{t("dashboard.noPendingRequests")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("dashboard.doctor")}</th><th>{t("dashboard.clinic")}</th><th>{t("patAppointments.requested")}</th><th>{t("common.status")}</th><th></th></tr></thead>
            <tbody>
              {data.requests.filter(r => ["PENDING","UNDER_REVIEW","RESCHEDULED"].includes(r.status)).map((r) => (
                <tr key={r.id}>
                  <td>Dr. {r.doctor_name}</td><td>{r.clinic_name}</td>
                  <td>{r.requested_date} {String(r.requested_time).slice(0,5)}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td><button className="btn small danger" onClick={() => cancelRequest(r.id)}>{t("patAppointments.cancel")}</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {activeChat && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h3>{t("patAppointments.conversationWith").replace("{name}", activeChat.doctor_name)}</h3>
            <button className="btn small secondary" onClick={() => setActiveChat(null)}>{t("common.close")}</button>
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            {messages.length === 0 && <div className="empty-state">{t("patAppointments.noMessages")}</div>}
            {messages.map((m) => (
              <div key={m.id} style={{ textAlign: m.sender_role === "patient" ? "right" : "left", marginBottom: 8 }}>
                {m.message_type === "audio" ? (
                  <div style={{ display: "inline-block" }}>
                    <AudioMessagePlayer messageId={m.id} />
                  </div>
                ) : (
                  <span style={{
                    display: "inline-block", padding: "6px 12px", borderRadius: 10,
                    background: m.sender_role === "patient" ? "var(--primary)" : "var(--chip-bg)",
                    color: m.sender_role === "patient" ? "#fff" : "var(--text)",
                  }}>{m.message}</span>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" style={{ marginBottom: 0 }} value={msgText} onChange={(e) => setMsgText(e.target.value)} placeholder={t("patAppointments.typeMessage")} />
            <button className="btn" onClick={sendMessage}>{t("patAppointments.send")}</button>
            <VoiceRecorderButton appointmentId={activeChat.id} onSent={() => openChat(activeChat)} />
          </div>
        </div>
      )}

      {feedbackFor && (
        <div className="card">
          <h3>{t("patAppointments.feedbackFor").replace("{name}", feedbackFor.doctor_name)}</h3>
          <label>{t("patAppointments.ratingLabel")}</label>
          <select value={rating} onChange={(e) => setRating(e.target.value)}>
            {[5,4,3,2,1].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <label>{t("patAppointments.commentLabel")}</label>
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn" onClick={submitFeedback}>{t("patAppointments.submitFeedback")}</button>
          <button className="btn secondary" style={{ marginLeft: 8 }} onClick={() => setFeedbackFor(null)}>{t("common.cancel")}</button>
        </div>
      )}
    </DashboardLayout>
  );
}
