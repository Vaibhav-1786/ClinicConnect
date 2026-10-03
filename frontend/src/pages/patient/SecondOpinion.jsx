import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const STATUS_BADGE = { PENDING: "PENDING", ACCEPTED: "CONFIRMED", DECLINED: "CANCELLED", REVIEWED: "COMPLETED" };

export default function SecondOpinion() {
  const [prescriptions, setPrescriptions] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState(null);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => {
    api.get("/prescriptions/patient").then((r) => setPrescriptions(r.data)).catch(() => setPrescriptions([]));
    api.get("/second-opinion/mine").then((r) => setRequests(r.data));
  };
  useEffect(() => { load(); }, []);

  const startRequest = (prescription) => {
    setForm({ prescription_id: prescription.id, doctor_name: prescription.doctor_name, target_doctor_id: "", patient_note: "", consent_given: false });
    api.get(`/second-opinion/doctors?exclude_doctor_id=${prescription.doctor_id}`).then((r) => setDoctors(r.data));
  };

  const submit = async () => {
    if (!form.target_doctor_id) { showToast(t("patSecondOpinion.chooseDoctorError"), "error"); return; }
    if (!form.consent_given) { showToast(t("patSecondOpinion.consentError"), "error"); return; }
    try {
      await api.post("/second-opinion", {
        prescription_id: form.prescription_id,
        target_doctor_id: form.target_doctor_id,
        patient_note: form.patient_note,
        consent_given: true,
      });
      showToast(t("patSecondOpinion.sent"), "success");
      setForm(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("patSecondOpinion.sendFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("patSecondOpinion.title")}>
      <div className="card">
        <h3>{t("patSecondOpinion.heading")}</h3>
        <p style={{ color: "var(--text-muted)" }}>{t("patSecondOpinion.intro")}</p>
        {prescriptions.length === 0 ? (
          <div className="empty-state">{t("patSecondOpinion.noPrescriptions")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("patSecondOpinion.colDate")}</th><th>{t("patSecondOpinion.colDoctor")}</th><th>{t("patSecondOpinion.colDiagnosis")}</th><th></th></tr></thead>
            <tbody>
              {prescriptions.map((p) => (
                <tr key={p.id}>
                  <td>{p.prescription_date}</td>
                  <td>{p.doctor_name}</td>
                  <td>{p.diagnosis_text || "—"}</td>
                  <td><button className="btn small secondary" onClick={() => startRequest(p)}>{t("patSecondOpinion.requestBtn")}</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {form && (
        <div className="card">
          <h3>{t("patSecondOpinion.formTitle").replace("{name}", form.doctor_name)}</h3>
          <label>{t("patSecondOpinion.chooseDoctor")}</label>
          <select value={form.target_doctor_id} onChange={(e) => setForm({ ...form, target_doctor_id: e.target.value })}>
            <option value="">{t("patSecondOpinion.selectDoctor")}</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name} — {d.specialization || "General"} ({d.experience_years} yrs)</option>
            ))}
          </select>
          <label style={{ marginTop: 10 }}>{t("patSecondOpinion.noteLabel")}</label>
          <textarea rows={3} value={form.patient_note} onChange={(e) => setForm({ ...form, patient_note: e.target.value })} placeholder={t("patSecondOpinion.notePlaceholder")} />
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <input type="checkbox" checked={form.consent_given} onChange={(e) => setForm({ ...form, consent_given: e.target.checked })} />
            {t("patSecondOpinion.consentLabel")}
          </label>
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={submit}>{t("patSecondOpinion.send")}</button>
            <button className="btn secondary" style={{ marginLeft: 8 }} onClick={() => setForm(null)}>{t("patSecondOpinion.cancel")}</button>
          </div>
        </div>
      )}

      <div className="card">
        <h3>{t("patSecondOpinion.yourRequests")}</h3>
        {requests.length === 0 ? (
          <div className="empty-state">{t("patSecondOpinion.noRequests")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("patSecondOpinion.colSent")}</th><th>{t("patSecondOpinion.colReviewingDoctor")}</th><th>{t("patSecondOpinion.colStatus")}</th><th>{t("patSecondOpinion.colResponse")}</th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>{r.target_doctor_name}</td>
                  <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                  <td>{r.opinion_text || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </DashboardLayout>
  );
}
