import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import VoiceRecorderButton from "../../components/VoiceRecorderButton";
import AudioMessagePlayer from "../../components/AudioMessagePlayer";

const NEXT_STATUS = {
  CONFIRMED: "CHECKED_IN",
  CHECKED_IN: "IN_CONSULTATION",
  IN_CONSULTATION: "COMPLETED",
};

const EMPTY_NOTE = { chief_complaint: "", examination: "", assessment: "", plan: "", follow_up: "" };

export default function DoctorAppointments() {
  const { t } = useLanguage();
  const NOTE_FIELDS = [
    ["chief_complaint", t("consultWorkspace.fieldChiefComplaint")],
    ["examination", t("consultWorkspace.fieldExamination")],
    ["assessment", t("consultWorkspace.fieldAssessment")],
    ["plan", t("consultWorkspace.fieldPlan")],
    ["follow_up", t("consultWorkspace.fieldFollowUp")],
  ];

  const [list, setList] = useState([]);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [active, setActive] = useState(null);
  const [vitals, setVitals] = useState({ blood_pressure: "", weight_kg: "", blood_sugar: "", temperature_f: "", pulse: "", spo2: "" });
  const [diagnosis, setDiagnosis] = useState("");
  const [rxItems, setRxItems] = useState([{ medicine_name: "", dosage: "", frequency: "", duration: "", before_after_food: "after", quantity: 1 }]);
  const EMPTY_REMINDER = { enabled: false, start_date: "", end_date: "", reminder_times: [], newTime: "" };
  const [reminder, setReminder] = useState({ ...EMPTY_REMINDER });
  const [warnings, setWarnings] = useState([]);
  const [allergyWarnings, setAllergyWarnings] = useState([]);
  const [duplicateWarnings, setDuplicateWarnings] = useState([]);
  const [fieldWarnings, setFieldWarnings] = useState([]);
  const [reminderWarnings, setReminderWarnings] = useState([]);
  const [uncheckedMedicines, setUncheckedMedicines] = useState([]);
  const [note, setNote] = useState({ ...EMPTY_NOTE });
  const [noteSource, setNoteSource] = useState("typed");
  const [templates, setTemplates] = useState([]);
  const [recordingField, setRecordingField] = useState("chief_complaint");
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = React.useRef(null);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgText, setMsgText] = useState("");
  const { showToast } = useToast();
  const navigate = useNavigate();

  const load = () => {
    const q = dateFilter ? `?date=${dateFilter}` : "";
    api.get(`/appointments/doctor${q}`).then((r) => setList(r.data));
  };
  useEffect(() => { load(); }, [dateFilter]);
  useEffect(() => { api.get("/doctor/note-templates").then((r) => setTemplates(r.data)).catch(() => {}); }, []);

  const openConsultation = (appt) => {
    setActive(appt);
    setDiagnosis("");
    setWarnings([]);
    setAllergyWarnings([]);
    setDuplicateWarnings([]);
    setFieldWarnings([]);
    setReminderWarnings([]);
    setUncheckedMedicines([]);
    setReminder({ ...EMPTY_REMINDER });
    setRxItems([{ medicine_name: "", dosage: "", frequency: "", duration: "", before_after_food: "after", quantity: 1 }]);
    setVitals({ blood_pressure: "", weight_kg: "", blood_sugar: "", temperature_f: "", pulse: "", spo2: "" });
    setNote({ ...EMPTY_NOTE });
    setNoteSource("typed");
    api.get(`/doctor/consultation-notes/${appt.id}`).then((r) => {
      if (r.data && r.data.id) {
        setNote({
          chief_complaint: r.data.chief_complaint || "", examination: r.data.examination || "",
          assessment: r.data.assessment || "", plan: r.data.plan || "", follow_up: r.data.follow_up || "",
        });
        setNoteSource(r.data.source);
      }
    }).catch(() => {});
  };

  const applyTemplate = (templateId) => {
    const tpl = templates.find((x) => String(x.id) === String(templateId));
    if (!tpl) return;
    setNote({
      chief_complaint: tpl.chief_complaint || "", examination: tpl.examination || "",
      assessment: tpl.assessment || "", plan: tpl.plan || "", follow_up: tpl.follow_up || "",
    });
    setNoteSource("template");
  };

  const saveNote = async () => {
    try {
      await api.put(`/doctor/consultation-notes/${active.id}`, { ...note, source: noteSource });
      showToast(t("consultWorkspace.noteSaved"), "success");
    } catch (err) {
      showToast(err.response?.data?.error || t("consultWorkspace.noteSaveError"), "error");
    }
  };

  const toggleRecording = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast(t("consultWorkspace.voiceUnsupported"), "error");
      return;
    }
    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setNote((prev) => ({ ...prev, [recordingField]: (prev[recordingField] ? prev[recordingField] + " " : "") + transcript.trim() }));
      setNoteSource("voice");
    };
    recognition.onerror = () => { setIsRecording(false); };
    recognition.onend = () => { setIsRecording(false); };
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

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

  const advanceStatus = async (appt) => {
    const next = NEXT_STATUS[appt.status];
    if (!next) return;
    try {
      await api.post(`/appointments/${appt.id}/status`, { status: next });
      showToast(t("consultWorkspace.statusUpdated", "Status updated to {status}").replace("{status}", next), "success");
      load();
      if (active && active.id === appt.id) setActive({ ...active, status: next });
    } catch (err) {
      showToast(err.response?.data?.error || t("consultWorkspace.statusUpdateError"), "error");
    }
  };

  const saveVitals = async () => {
    try {
      await api.post("/vitals", { patient_id: active.patient_id, appointment_id: active.id, ...vitals });
      showToast(t("consultWorkspace.vitalsRecorded"), "success");
    } catch (err) { showToast(t("consultWorkspace.vitalsSaveError"), "error"); }
  };

  const updateRxItem = (idx, field, value) => {
    const next = [...rxItems];
    next[idx] = { ...next[idx], [field]: value };
    setRxItems(next);
  };
  const addRxItem = () => setRxItems([...rxItems, { medicine_name: "", dosage: "", frequency: "", duration: "", before_after_food: "after", quantity: 1 }]);
  const updateReminder = (field, value) => setReminder((r) => ({ ...r, [field]: value }));
  const addReminderTime = () => {
    setReminder((r) => {
      const tm = r.newTime;
      if (!tm || r.reminder_times.includes(tm)) return r;
      return { ...r, reminder_times: [...r.reminder_times, tm].sort(), newTime: "" };
    });
  };
  const removeReminderTime = (tm) => setReminder((r) => ({ ...r, reminder_times: r.reminder_times.filter((x) => x !== tm) }));

  const savePrescription = async () => {
    const validItems = rxItems.filter((i) => i.medicine_name.trim());
    if (validItems.length === 0) {
      showToast(t("consultWorkspace.medicineNameRequired"), "error");
      return;
    }
    // A row with other fields filled in but no name is an error, not
    // silently dropped.
    const hasNamelessRow = rxItems.some((i) => !i.medicine_name.trim() && (i.dosage || i.frequency || i.duration));
    if (hasNamelessRow) {
      showToast(t("consultWorkspace.medicineNameRequired"), "error");
      return;
    }
    try {
      const res = await api.post("/prescriptions", {
        appointment_id: active.id, diagnosis_text: diagnosis,
        items: validItems.map((i) => ({
          medicine_name: i.medicine_name.trim(), dosage: i.dosage, frequency: i.frequency,
          duration: i.duration, before_after_food: i.before_after_food, quantity: i.quantity,
          instructions: i.instructions,
          ...(reminder.enabled && reminder.start_date && reminder.end_date && reminder.reminder_times.length
            ? { start_date: reminder.start_date, end_date: reminder.end_date, reminder_times: reminder.reminder_times }
            : {}),
        })),
      });
      setWarnings(res.data.drug_interaction_warnings || []);
      setAllergyWarnings(res.data.allergy_warnings || []);
      setDuplicateWarnings(res.data.duplicate_medicine_warnings || []);
      setFieldWarnings(res.data.field_warnings || []);
      setReminderWarnings(res.data.reminder_warnings || []);
      setUncheckedMedicines(res.data.unchecked_medicines || []);
      showToast(t("consultWorkspace.prescriptionSaved"), "success");
    } catch (err) {
      showToast(err.response?.data?.error || t("consultWorkspace.prescriptionSaveError"), "error");
    }
  };

  return (
    <DashboardLayout title="Appointments">
      <div className="card">
        <label>{t("consultWorkspace.filterByDate")}</label>
        <input type="date" className="input" style={{ maxWidth: 220 }} value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
      </div>

      <div className="card">
        {list.length === 0 ? <div className="empty-state">{t("consultWorkspace.noAppointments")}</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("consultWorkspace.time")}</th><th>{t("consultWorkspace.patient")}</th><th>{t("consultWorkspace.clinic")}</th><th>{t("consultWorkspace.status")}</th><th></th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td>{String(a.appointment_time).slice(0,5)}</td>
                  <td>{a.patient_name} ({a.patient_code})</td>
                  <td>{a.clinic_name}</td>
                  <td><span className={`badge ${a.status}`}>{a.status}</span></td>
                  <td><div className="row-actions">
                    <button className="btn small secondary" onClick={() => openConsultation(a)}>{t("consultWorkspace.open")}</button>
                    {a.consultation_mode === "ONLINE" && ["CONFIRMED","CHECKED_IN","IN_CONSULTATION"].includes(a.status) && (
                      <button className="btn small" onClick={() => navigate(`/doctor/video-consultation/${a.id}`)}>{t("consultWorkspace.videoCall")}</button>
                    )}
                    {["CONFIRMED","CHECKED_IN","IN_CONSULTATION","COMPLETED"].includes(a.status) && (
                      <button className="btn small secondary" onClick={() => openChat(a)}>{t("consultWorkspace.message")}</button>
                    )}
                    {NEXT_STATUS[a.status] && (
                      <button className="btn small" onClick={() => advanceStatus(a)}>{t("consultWorkspace.markStatus", "Mark {status}").replace("{status}", NEXT_STATUS[a.status])}</button>
                    )}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {activeChat && (
        <div className="card">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
            <h3>{t("consultWorkspace.conversationWith", "Conversation with {name}").replace("{name}", activeChat.patient_name)}</h3>
            <button className="btn small secondary" onClick={() => setActiveChat(null)}>{t("consultWorkspace.close")}</button>
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            {messages.length === 0 && <div className="empty-state">{t("consultWorkspace.noMessages")}</div>}
            {messages.map((m) => (
              <div key={m.id} style={{ textAlign: m.sender_role === "doctor" ? "right" : "left", marginBottom: 8 }}>
                {m.message_type === "audio" ? (
                  <div style={{ display: "inline-block" }}>
                    <AudioMessagePlayer messageId={m.id} />
                  </div>
                ) : (
                  <span style={{
                    display: "inline-block", maxWidth: "85%", padding: "6px 12px", borderRadius: 10, textAlign: "left",
                    background: m.sender_role === "doctor" ? "var(--primary)" : "var(--chip-bg)",
                    color: m.sender_role === "doctor" ? "#fff" : "var(--text)",
                  }}>{m.message}</span>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" style={{ marginBottom: 0 }} value={msgText} onChange={(e) => setMsgText(e.target.value)} placeholder={t("consultWorkspace.typeMessage")} />
            <button className="btn" onClick={sendMessage}>{t("consultWorkspace.send")}</button>
            <VoiceRecorderButton appointmentId={activeChat.id} onSent={() => openChat(activeChat)} />
          </div>
        </div>
      )}

      {active && (
        <div className="card">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
            <h3>{t("consultWorkspace.consultationWith", "Consultation — {name} ({code})").replace("{name}", active.patient_name).replace("{code}", active.patient_code)}</h3>
            <button className="btn small secondary" onClick={() => setActive(null)}>{t("consultWorkspace.close")}</button>
          </div>
          <p>{t("consultWorkspace.status")}: <span className={`badge ${active.status}`}>{active.status}</span>
             {NEXT_STATUS[active.status] && (
               <button className="btn small" style={{ marginLeft: 10 }} onClick={() => advanceStatus(active)}>
                 {t("consultWorkspace.markStatus", "Mark {status}").replace("{status}", NEXT_STATUS[active.status])}
               </button>
             )}
          </p>

          <h4>{t("consultWorkspace.vitals")}</h4>
          <div className="grid grid-3">
            <input className="input" placeholder={t("consultWorkspace.bloodPressure")} value={vitals.blood_pressure} onChange={(e) => setVitals({ ...vitals, blood_pressure: e.target.value })} />
            <input className="input" placeholder={t("consultWorkspace.weightKg")} value={vitals.weight_kg} onChange={(e) => setVitals({ ...vitals, weight_kg: e.target.value })} />
            <input className="input" placeholder={t("consultWorkspace.bloodSugar")} value={vitals.blood_sugar} onChange={(e) => setVitals({ ...vitals, blood_sugar: e.target.value })} />
            <input className="input" placeholder={t("consultWorkspace.temperature")} value={vitals.temperature_f} onChange={(e) => setVitals({ ...vitals, temperature_f: e.target.value })} />
            <input className="input" placeholder={t("consultWorkspace.pulse")} value={vitals.pulse} onChange={(e) => setVitals({ ...vitals, pulse: e.target.value })} />
            <input className="input" placeholder={t("consultWorkspace.spo2")} value={vitals.spo2} onChange={(e) => setVitals({ ...vitals, spo2: e.target.value })} />
          </div>
          <button className="btn secondary small" onClick={saveVitals}>{t("consultWorkspace.saveVitals")}</button>

          <h4 style={{ marginTop: 20 }}>{t("consultWorkspace.consultationNotes")}</h4>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <select style={{ width: "min(100%, 220px)" }} onChange={(e) => e.target.value && applyTemplate(e.target.value)} defaultValue="">
              <option value="">{t("consultWorkspace.useTemplate")}</option>
              {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.title}</option>)}
            </select>
            <select style={{ width: "min(100%, 160px)" }} value={recordingField} onChange={(e) => setRecordingField(e.target.value)}>
              {NOTE_FIELDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <button type="button" className={`btn small ${isRecording ? "danger" : "secondary"}`} onClick={toggleRecording}>
              {isRecording ? t("consultWorkspace.stopRecording") : t("consultWorkspace.startRecording")}
            </button>
            {noteSource === "voice" && <span className="pill">{t("consultWorkspace.voiceTranscribed")}</span>}
          </div>
          <div className="grid grid-3">
            {NOTE_FIELDS.map(([key, label]) => (
              <div key={key}>
                <label>{label}</label>
                <textarea rows={2} value={note[key]} onChange={(e) => { setNote({ ...note, [key]: e.target.value }); setNoteSource("typed"); }} />
              </div>
            ))}
          </div>
          <button className="btn secondary small" onClick={saveNote}>{t("consultWorkspace.saveNote")}</button>

          <h4 style={{ marginTop: 20 }}>{t("consultWorkspace.diagnosis")}</h4>
          <textarea rows={2} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder={t("consultWorkspace.enterDiagnosis")} />

          <h4>{t("consultWorkspace.prescription")}</h4>
          {rxItems.map((it, idx) => (
            <div className="rx-row" key={idx}>
              <input className="input rx-name" placeholder={t("consultWorkspace.enterMedicineName")} aria-label={t("consultWorkspace.medicineName")} maxLength={150} required value={it.medicine_name} onChange={(e) => updateRxItem(idx, "medicine_name", e.target.value)} />
              <input className="input" aria-label={t("consultWorkspace.dosage")} placeholder={t("consultWorkspace.dosage")} value={it.dosage} onChange={(e) => updateRxItem(idx, "dosage", e.target.value)} />
              <input className="input" aria-label={t("consultWorkspace.frequency")} placeholder={t("consultWorkspace.frequency")} value={it.frequency} onChange={(e) => updateRxItem(idx, "frequency", e.target.value)} />
              <input className="input" aria-label={t("consultWorkspace.duration")} placeholder={t("consultWorkspace.duration")} value={it.duration} onChange={(e) => updateRxItem(idx, "duration", e.target.value)} />
              <select value={it.before_after_food} onChange={(e) => updateRxItem(idx, "before_after_food", e.target.value)}>
                <option value="before">{t("consultWorkspace.beforeFood")}</option>
                <option value="after">{t("consultWorkspace.afterFood")}</option>
                <option value="anytime">{t("consultWorkspace.anytime")}</option>
              </select>
              <input className="input" type="number" min="1" aria-label="Quantity" value={it.quantity} onChange={(e) => updateRxItem(idx, "quantity", e.target.value)} />
            </div>
          ))}
          <div style={{ margin: "6px 0 14px", padding: "10px 12px", background: "var(--bg-subtle, #f8fafc)", borderRadius: 8 }}>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 8, margin: 0, textAlign: "left" }}>
              <input type="checkbox" style={{ width: "auto", flex: "0 0 auto", margin: 0 }} checked={reminder.enabled} onChange={(e) => updateReminder("enabled", e.target.checked)} />
              <span>{t("consultWorkspace.setReminders", "Set patient reminders for {medicine}").replace("{medicine}", t("consultWorkspace.thisMedicine"))}</span>
            </label>
            {reminder.enabled && (
              <div className="grid grid-3" style={{ marginTop: 8 }}>
                <div><label>{t("consultWorkspace.startDate")}</label><input type="date" className="input" value={reminder.start_date} onChange={(e) => updateReminder("start_date", e.target.value)} /></div>
                <div><label>{t("consultWorkspace.endDate")}</label><input type="date" className="input" value={reminder.end_date} onChange={(e) => updateReminder("end_date", e.target.value)} /></div>
                <div>
                  <label>{t("consultWorkspace.reminderTime")}</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input type="time" className="input" value={reminder.newTime} onChange={(e) => updateReminder("newTime", e.target.value)} />
                    <button type="button" className="btn small secondary" onClick={addReminderTime}>{t("consultWorkspace.add")}</button>
                  </div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  {reminder.reminder_times.map((tm) => (
                    <span key={tm} className="pill" style={{ cursor: "pointer" }} onClick={() => removeReminderTime(tm)}>{tm} ✕</span>
                  ))}
                  {reminder.reminder_times.length === 0 && <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("consultWorkspace.noReminderTimes")}</span>}
                </div>
              </div>
            )}
          </div>
          <button className="btn secondary small" onClick={addRxItem}>{t("consultWorkspace.addMedicine")}</button>
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={savePrescription}>{t("consultWorkspace.savePrescription")}</button>
          </div>

          {uncheckedMedicines.length > 0 && (
            <div className="card" style={{ marginTop: 12 }} role="status">
              <strong>{t("consultWorkspace.uncheckedTitle")}</strong>
              <ul>{uncheckedMedicines.map((n, i) => <li key={i}>{n}</li>)}</ul>
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("consultWorkspace.uncheckedNote")}</p>
            </div>
          )}

          {allergyWarnings.length > 0 && (
            <div className="card" style={{ background: "var(--danger-soft)", borderColor: "var(--danger)", marginTop: 12 }} role="alert">
              <strong>{t("consultWorkspace.allergyWarningTitle")}</strong>
              <ul>
                {allergyWarnings.map((w, i) => (
                  <li key={i}>{w.medicine_name} — {w.allergy}{w.note ? `: ${w.note}` : ""}</li>
                ))}
              </ul>
              <p style={{ fontSize: 13, color: "var(--danger-soft-text)" }}>{t("consultWorkspace.allergyWarningNote")}</p>
            </div>
          )}

          {duplicateWarnings.length > 0 && (
            <div className="card" style={{ background: "var(--warning-soft)", borderColor: "var(--warning)", marginTop: 12 }} role="alert">
              <strong>{t("consultWorkspace.duplicateWarningTitle")}</strong>
              <ul>{duplicateWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              <p style={{ fontSize: 13, color: "var(--warning-soft-text)" }}>{t("consultWorkspace.duplicateWarningNote")}</p>
            </div>
          )}

          {fieldWarnings.length > 0 && (
            <div className="card" style={{ background: "var(--warning-soft)", borderColor: "var(--warning)", marginTop: 12 }} role="alert">
              <strong>{t("consultWorkspace.fieldWarningTitle")}</strong>
              <ul>{fieldWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              <p style={{ fontSize: 13, color: "var(--warning-soft-text)" }}>{t("consultWorkspace.fieldWarningNote")}</p>
            </div>
          )}

          {reminderWarnings.length > 0 && (
            <div className="card" style={{ background: "var(--warning-soft)", borderColor: "var(--warning)", marginTop: 12 }}>
              <strong>{t("consultWorkspace.reminderWarningTitle")}</strong>
              <ul>{reminderWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              <p style={{ fontSize: 13, color: "var(--warning-soft-text)" }}>{t("consultWorkspace.reminderWarningNote")}</p>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="card" style={{ background: "var(--warning-soft)", borderColor: "var(--warning)", marginTop: 12 }} role="alert">
              <strong>{t("consultWorkspace.interactionWarningTitle")}</strong>
              <ul>
                {warnings.map((w, i) => (
                  <li key={i}>{w.medicine_a} + {w.medicine_b} — {w.severity.toUpperCase()}: {w.description}</li>
                ))}
              </ul>
              <p style={{ fontSize: 13, color: "var(--warning-soft-text)" }}>{t("consultWorkspace.interactionWarningNote")}</p>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
