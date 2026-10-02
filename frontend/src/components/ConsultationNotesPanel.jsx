import React, { useEffect, useRef, useState } from "react";
import api from "../services/api";
import { useToast } from "../context/ToastContext";

const EMPTY_NOTE = { chief_complaint: "", examination: "", assessment: "", plan: "", follow_up: "" };
const NOTE_FIELDS = [
  ["chief_complaint", "Chief Complaint"], ["examination", "Examination"],
  ["assessment", "Assessment"], ["plan", "Plan"], ["follow_up", "Follow-up"],
];

/**
 * Consultation note editor with live voice dictation (Web Speech API),
 * meant to sit alongside a live video call so the doctor can dictate
 * findings hands-free while talking to the patient. Nothing here is
 * auto-saved as a diagnosis/prescription — same source-tracking model as
 * the typed/template editor on the regular appointments page.
 */
export default function ConsultationNotesPanel({ appointmentId }) {
  const [note, setNote] = useState({ ...EMPTY_NOTE });
  const [source, setSource] = useState("typed");
  const [recordingField, setRecordingField] = useState("chief_complaint");
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);
  const { showToast } = useToast();

  useEffect(() => {
    api.get(`/doctor/consultation-notes/${appointmentId}`).then((r) => {
      if (r.data && r.data.id) {
        setNote({
          chief_complaint: r.data.chief_complaint || "", examination: r.data.examination || "",
          assessment: r.data.assessment || "", plan: r.data.plan || "", follow_up: r.data.follow_up || "",
        });
        setSource(r.data.source);
      }
    }).catch(() => {});
    return () => { recognitionRef.current?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId]);

  const toggleRecording = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Voice input isn't supported in this browser. Try Chrome or Edge.", "error");
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
      setSource("voice");
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const save = async () => {
    try {
      await api.put(`/doctor/consultation-notes/${appointmentId}`, { ...note, source });
      showToast("Consultation note saved", "success");
    } catch (err) {
      showToast(err.response?.data?.error || "Could not save note", "error");
    }
  };

  return (
    <div className="card">
      <h4>Consultation Notes</h4>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <select style={{ width: "min(100%, 160px)" }} value={recordingField} onChange={(e) => setRecordingField(e.target.value)}>
          {NOTE_FIELDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <button type="button" className={`btn small ${isRecording ? "danger" : "secondary"}`} onClick={toggleRecording}>
          {isRecording ? "⏹ Stop Recording" : "🎤 Dictate While On Call"}
        </button>
        {source === "voice" && <span className="pill">Voice-transcribed — review before saving</span>}
      </div>
      {NOTE_FIELDS.map(([key, label]) => (
        <div key={key} style={{ marginBottom: 8 }}>
          <label>{label}</label>
          <textarea rows={2} value={note[key]} onChange={(e) => { setNote({ ...note, [key]: e.target.value }); setSource("typed"); }} />
        </div>
      ))}
      <button className="btn secondary small" onClick={save}>Save Consultation Note</button>
    </div>
  );
}
