import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const STATUS_BADGE = { PENDING: "PENDING", ACCEPTED: "CONFIRMED", DECLINED: "CANCELLED", REVIEWED: "COMPLETED" };

export default function SecondOpinionInbox() {
  const [requests, setRequests] = useState([]);
  const [active, setActive] = useState(null);
  const [context, setContext] = useState(null);
  const [opinionText, setOpinionText] = useState("");
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => api.get("/second-opinion/inbox").then((r) => setRequests(r.data));
  useEffect(() => { load(); }, []);

  const open = async (req) => {
    setActive(req);
    setOpinionText(req.opinion_text || "");
    const r = await api.get(`/second-opinion/${req.id}/context`);
    setContext(r.data);
  };

  const respond = async (status) => {
    if (status === "REVIEWED" && !opinionText.trim()) {
      showToast(t("docSecondOpinionInbox.opinionRequired"), "error");
      return;
    }
    try {
      await api.post(`/second-opinion/${active.id}/respond`, { status, opinion_text: opinionText });
      showToast(t("docSecondOpinionInbox.updated").replace("{status}", status.toLowerCase()), "success");
      setActive(null); setContext(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("docSecondOpinionInbox.updateFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("docSecondOpinionInbox.title")}>
      <div className="card">
        <h3>{t("docSecondOpinionInbox.heading")}</h3>
        {requests.length === 0 ? (
          <div className="empty-state">{t("docSecondOpinionInbox.empty")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr>
              <th>{t("docSecondOpinionInbox.colReceived")}</th><th>{t("docSecondOpinionInbox.colPatient")}</th>
              <th>{t("docSecondOpinionInbox.colStatus")}</th><th></th>
            </tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>{r.patient_name} ({r.patient_code})</td>
                  <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                  <td><button className="btn small secondary" onClick={() => open(r)}>{t("docSecondOpinionInbox.open")}</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {active && context && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h3>{t("docSecondOpinionInbox.reviewHeading").replace("{name}", active.patient_name)}</h3>
            <button className="btn small secondary" onClick={() => { setActive(null); setContext(null); }}>{t("docSecondOpinionInbox.close")}</button>
          </div>
          {active.patient_note && <p><strong>{t("docSecondOpinionInbox.patientNote")}</strong> {active.patient_note}</p>}
          {context.prescription && (
            <>
              <h4>{t("docSecondOpinionInbox.originalDiagnosis").replace("{name}", active.original_doctor_name)}</h4>
              <p>{context.prescription.diagnosis_text || "—"}</p>
              <h4>{t("docSecondOpinionInbox.prescribedMedicines")}</h4>
              <ul>
                {(context.medicines || []).map((m, i) => (
                  <li key={i}>{m.name} — {m.dosage}, {m.frequency}, {m.duration}</li>
                ))}
              </ul>
            </>
          )}
          <h4>{t("docSecondOpinionInbox.yourOpinion")}</h4>
          <textarea rows={4} value={opinionText} onChange={(e) => setOpinionText(e.target.value)} placeholder={t("docSecondOpinionInbox.opinionPlaceholder")} />
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            {active.status === "PENDING" && (
              <>
                <button className="btn secondary small" onClick={() => respond("ACCEPTED")}>{t("docSecondOpinionInbox.acceptRequest")}</button>
                <button className="btn danger small" onClick={() => respond("DECLINED")}>{t("docSecondOpinionInbox.decline")}</button>
              </>
            )}
            <button className="btn small" onClick={() => respond("REVIEWED")}>{t("docSecondOpinionInbox.submitOpinion")}</button>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
