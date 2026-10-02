import React, { useEffect, useState } from "react";
import api from "../services/api";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";

const CATEGORY_PILL_CLASS = { normal: "pill-success", priority: "pill-warning", urgent: "pill-danger" };

/**
 * Digital Triage (spec section 6). A structured pre-consultation record.
 * The computed category is decision-support only, never framed as a
 * diagnosis, and can always be overridden by authorized staff.
 *
 * Props: queueId (walk-in token) OR appointmentId — pass whichever the
 * caller has; onSaved(category) is called after a successful save.
 */
export default function TriageForm({ queueId, appointmentId, onSaved }) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    chief_complaint: "", symptoms: "", temperature_f: "", blood_pressure: "",
    pulse: "", spo2: "", weight_kg: "", height_cm: "", pain_level: "",
    emergency_indicator: false, notes: "",
  });
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadHistory = () => {
    const url = queueId ? `/triage/queue/${queueId}` : `/triage/appointment/${appointmentId}`;
    api.get(url).then((r) => setHistory(r.data)).catch(() => setHistory([]));
  };
  useEffect(() => { loadHistory(); }, [queueId, appointmentId]);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.post("/triage", {
        ...(queueId ? { queue_id: queueId } : { appointment_id: appointmentId }),
        ...form,
      });
      showToast(t("triageForm.saved"), "success");
      loadHistory();
      onSaved?.(res.data.category);
    } catch (err) {
      showToast(err.response?.data?.error || t("triageForm.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const override = async (triageId, category) => {
    try {
      await api.put(`/triage/${triageId}/classification`, { category });
      showToast(t("triageForm.overrideSaved"), "success");
      loadHistory();
      onSaved?.(category);
    } catch (err) {
      showToast(err.response?.data?.error || t("triageForm.overrideFailed"), "error");
    }
  };

  return (
    <div>
      <div className="grid grid-3">
        <div style={{ gridColumn: "1 / -1" }}>
          <label>{t("triageForm.chiefComplaint")}</label>
          <textarea rows={2} value={form.chief_complaint} onChange={set("chief_complaint")} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label>{t("triageForm.symptoms")}</label>
          <textarea rows={2} value={form.symptoms} onChange={set("symptoms")} />
        </div>
        <div><label>{t("triageForm.temperature")}</label><input className="input" value={form.temperature_f} onChange={set("temperature_f")} /></div>
        <div><label>{t("triageForm.bloodPressure")}</label><input className="input" placeholder="120/80" value={form.blood_pressure} onChange={set("blood_pressure")} /></div>
        <div><label>{t("triageForm.pulse")}</label><input className="input" value={form.pulse} onChange={set("pulse")} /></div>
        <div><label>{t("triageForm.spo2")}</label><input className="input" value={form.spo2} onChange={set("spo2")} /></div>
        <div><label>{t("triageForm.weight")}</label><input className="input" value={form.weight_kg} onChange={set("weight_kg")} /></div>
        <div><label>{t("triageForm.height")}</label><input className="input" value={form.height_cm} onChange={set("height_cm")} /></div>
        <div><label>{t("triageForm.painLevel")}</label><input className="input" type="number" min="0" max="10" value={form.pain_level} onChange={set("pain_level")} /></div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={form.emergency_indicator} onChange={set("emergency_indicator")} />
        {t("triageForm.emergencyIndicator")}
      </label>
      <label>{t("triageForm.notes")}</label>
      <textarea rows={2} value={form.notes} onChange={set("notes")} />
      <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t("triageForm.workflowNote")}</p>
      <button className="btn small" onClick={save} disabled={saving}>{t("triageForm.save")}</button>

      <h4 style={{ marginTop: 16 }}>{t("triageForm.history")}</h4>
      {history.length === 0 ? (
        <div className="empty-state">{t("triageForm.noHistory")}</div>
      ) : (
        history.map((h) => (
          <div key={h.id} className="card" style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className={`pill ${CATEGORY_PILL_CLASS[h.category]}`}>{t(`triageForm.${h.category}`)}</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{String(h.created_at).replace("T", " ").slice(0, 16)}</span>
            </div>
            {h.category_reason && <p style={{ fontSize: 13, margin: "6px 0" }}>{h.category_reason}</p>}
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t("triageForm.overrideCategory")}:</span>
              {["normal", "priority", "urgent"].map((c) => (
                <button key={c} className="btn small secondary" style={{ padding: "2px 10px" }} disabled={c === h.category} onClick={() => override(h.id, c)}>
                  {t(`triageForm.${c}`)}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
