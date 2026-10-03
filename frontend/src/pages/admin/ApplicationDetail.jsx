import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import AdminComments from "../../components/AdminComments";

const STEP_KEYS = [
  "SUBMITTED", "DOCUMENTS_UPLOADED", "ADMIN_REVIEW", "DOCUMENTS_VERIFIED",
  "ORGANIZATION_ASSIGNED", "APPROVED", "DOCTOR_ACTIVE",
];

const RISK_PILL = { LOW: "pill-success", MODERATE: "pill-warning", HIGH: "pill-danger", CRITICAL: "pill-danger" };

function DocumentLink({ doc }) {
  const openDoc = async () => {
    const res = await api.get(`/admin/documents/${doc.id}/download`, { responseType: "blob" });
    const url = window.URL.createObjectURL(res.data);
    window.open(url, "_blank");
  };
  return <a onClick={openDoc} style={{ cursor: "pointer" }}>{doc.original_name}</a>;
}

export default function AdminApplicationDetail() {
  const { id } = useParams();
  const [app, setApp] = useState(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState(null);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [timeline, setTimeline] = useState(null);
  const [duplicates, setDuplicates] = useState([]);
  const [risk, setRisk] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [loadingReco, setLoadingReco] = useState(false);

  const load = () => api.get(`/admin/applications/${id}`).then((r) => setApp(r.data));
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    api.get(`/admin/applications/${id}/timeline`).then((r) => setTimeline(r.data)).catch(() => {});
    api.get(`/admin/applications/${id}/duplicate-check`).then((r) => setDuplicates(r.data)).catch(() => {});
    api.get(`/admin/applications/${id}/risk-score`).then((r) => setRisk(r.data)).catch(() => {});
  }, [id]);

  const loadRecommendations = async () => {
    setLoadingReco(true);
    try {
      const res = await api.get(`/admin/applications/${id}/recommended-organizations`);
      setRecommendations(res.data.recommendations);
    } finally {
      setLoadingReco(false);
    }
  };

  const recordDuplicateDecision = async (resultId, decision) => {
    await api.post(`/admin/duplicate-check/${resultId}/decision`, { decision });
    showToast(t("adminAppDetail.decisionRecorded"), "success");
    api.get(`/admin/applications/${id}/duplicate-check`).then((r) => setDuplicates(r.data));
  };

  const approve = async () => {
    try {
      const res = await api.post(`/admin/applications/${id}/approve`);
      setResult(res.data);
      showToast(t("adminAppDetail.approved"), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("recAppointments.approveFailed"), "error");
    }
  };

  const reject = async () => {
    if (!reason.trim()) { showToast(t("adminAppDetail.provideReason"), "error"); return; }
    try {
      await api.post(`/admin/applications/${id}/reject`, { reason });
      showToast(t("adminAppDetail.rejected"), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("recAppointments.rejectFailed"), "error");
    }
  };

  const saveNote = async () => {
    await api.post(`/admin/applications/${id}/note`, { note });
    showToast(t("adminAppDetail.noteSaved"), "success");
    load();
  };

  if (!app) return <DashboardLayout title={t("adminAppDetail.application")}><p>{t("common.loading")}</p></DashboardLayout>;

  return (
    <DashboardLayout title={`${t("adminAppDetail.application")} #${app.id}`}>
      {result && (
        <div className="card" style={{ background: "var(--badge-approved-bg)", borderColor: "var(--success)", marginBottom: 16 }}>
          <h3>{t("adminAppDetail.approvedCredentials")}</h3>
          <p>{t("adminDoctors.doctorId")}: <strong>{result.doctor_id}</strong></p>
          <p>{t("docReceptionists.clinicId")}: <strong>{result.clinic_id}</strong> ({result.clinic_name})</p>
          {result.temporary_password
            ? <p>{t("docReceptionists.tempPassword")}: <strong>{result.temporary_password}</strong> {t("adminAppDetail.shownOnce")}</p>
            : <p>{result.note}</p>}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{t("adminAppDetail.doctorDetails")}</h3>
        <p><strong>{app.full_name}</strong> · {app.specialization} · {app.qualification}</p>
        <p>{t("adminAppDetail.registration")}: {app.registration_number} ({app.registration_authority}, {app.registration_year})</p>
        <p>{t("adminAppDetail.experience")}: {app.experience_years} {t("adminAppDetail.years")} · {t("adminAppDetail.consultationFee")}: ₹{app.consultation_fee}</p>
        <p>{t("adminAppDetail.contact")}: {app.mobile} · {app.email}</p>
        <p>{t("patFamily.address")}: {app.address}</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{t("adminAppDetail.clinicDetails")}</h3>
        {app.existing_clinic_id ? (
          <p>{t("adminAppDetail.linkingExisting").replace("{id}", app.existing_clinic_id)}</p>
        ) : (
          <>
            <p><strong>{app.clinic_name}</strong> · {app.org_type}</p>
            <p>{app.clinic_address} {app.clinic_pincode}</p>
            <p>{t("adminAppDetail.contact")}: {app.clinic_phone} · {app.clinic_email}</p>
            <p>{t("adminAppDetail.hours")}: {app.opening_time} - {app.closing_time} ({app.working_days})</p>
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{t("adminAppDetail.documents")}</h3>
        {app.documents.length === 0 ? <p>{t("adminAppDetail.noDocuments")}</p> : (
          <ul className="doc-list">
            {app.documents.map((d) => (
              <li key={d.id}>
                {d.doc_type.replace(/_/g, " ")}: <DocumentLink doc={d} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{t("adminAppDetail.adminNote")}</h3>
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={app.admin_note || t("adminAppDetail.addNote")} />
        <button className="btn btn-outline btn-sm" onClick={saveNote}>{t("adminAppDetail.saveNote")}</button>
      </div>

      {/* Application Risk Score — feature 20. Advisory only; never auto-rejects. */}
      {risk && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>{t("adminAppDetail.riskScore")}</h3>
          <p style={{ fontSize: 22, fontWeight: 700 }}>
            {risk.risk_score} / 100 <span className={`pill ${RISK_PILL[risk.risk_level]}`}>{t(`adminAppDetail.riskLevel.${risk.risk_level}`)}</span>
          </p>
          {risk.factors && risk.factors.length > 0 && (
            <ul style={{ color: "var(--text-muted)", fontSize: 13 }}>
              {risk.factors.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Duplicate Doctor Detection — feature 13. Never auto-merges. */}
      {duplicates.length > 0 && (
        <div className="card" style={{ marginBottom: 16, background: "var(--warning-soft)", color: "var(--warning-soft-text)" }}>
          <h3>⚠️ {t("adminAppDetail.possibleDuplicate")}</h3>
          {duplicates.map((d) => (
            <div key={d.id || d.result_id} className="card" style={{ marginBottom: 8 }}>
              <p><strong>{d.matched_doctor_name}</strong> — {d.overall_match_pct}% {t("adminAppDetail.match")}</p>
              {d.existing_clinic_name && <p>{t("adminAppDetail.alreadyRegisteredAt")}: {d.existing_clinic_name}</p>}
              <div style={{ display: "flex", gap: 6 }}>
                {d.matched_doctor_id && (
                  <button className="btn btn-outline btn-sm" onClick={() => navigate(`/admin/doctors/${d.matched_doctor_id}`)}>
                    {t("adminAppDetail.viewExistingDoctor")}
                  </button>
                )}
                {(d.id || d.result_id) && (
                  <button className="btn btn-outline btn-sm" onClick={() => recordDuplicateDecision(d.id || d.result_id, "CONTINUED_ANYWAY")}>
                    {t("adminAppDetail.continueAnyway")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recommended Organizations — features 1 & 18 */}
      {app.existing_clinic_id == null && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>{t("adminAppDetail.bestMatchingClinics")}</h3>
          <button className="btn btn-outline btn-sm" onClick={loadRecommendations} disabled={loadingReco}>
            {loadingReco ? t("common.loading") : t("doctorDetail.findMatches")}
          </button>
          {recommendations.length > 0 && (
            <div className="card-grid" style={{ marginTop: 12 }}>
              {recommendations.map((r, i) => (
                <div className="card" key={r.clinic_id}>
                  <h4>{["🥇", "🥈", "🥉"][i] || "•"} {r.clinic_name}</h4>
                  <p style={{ fontWeight: 700, fontSize: 20 }}>{r.match_score}% {t("doctorDetail.match")}</p>
                  <ul style={{ fontSize: 13, color: "var(--text-muted)", paddingLeft: 18 }}>
                    {r.reasons.map((reason, ri) => <li key={ri}>{reason}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Application Timeline — feature 9, immutable */}
      {timeline && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>{t("adminAppDetail.timeline")}</h3>
          <ol style={{ listStyle: "none", padding: 0 }}>
            {timeline.steps.map((s) => (
              <li key={s.step_key} style={{ display: "flex", gap: 10, marginBottom: 10, opacity: s.status === "DONE" ? 1 : 0.4 }}>
                <span>{s.status === "DONE" ? "✅" : "⬜"}</span>
                <div>
                  <strong>{t(`adminAppDetail.step.${s.step_key}`)}</strong>
                  {s.events.map((e) => (
                    <div key={e.id} style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {new Date(e.created_at).toLocaleString()} — {e.performed_by_email || t("adminAppDetail.system")}
                      {e.comment ? `: "${e.comment}"` : ""}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          {timeline.rejected_events.length > 0 && (
            <div style={{ color: "var(--badge-rejected-text)" }}>
              {timeline.rejected_events.map((e) => (
                <p key={e.id}>❌ {t("adminAppDetail.step.REJECTED")} — {new Date(e.created_at).toLocaleString()}: {e.comment}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <AdminComments entityType="APPLICATION" entityId={id} />

      <p>{t("common.status")}: <span className="pill">{app.status}</span></p>

      {app.status !== "APPROVED" && app.status !== "REJECTED" && (
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn" onClick={approve}>{t("adminAppDetail.approveApplication")}</button>
          <input className="input" style={{ margin: 0, width: "min(100%, 260px)" }} placeholder={t("recAppointments.reasonForRejection")} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn btn-danger" onClick={reject}>{t("adminAppDetail.rejectApplication")}</button>
        </div>
      )}
      {app.status === "REJECTED" && <p style={{ color: "var(--badge-rejected-text)" }}>{t("recAppointments.rejectedOpt")}: {app.rejection_reason}</p>}
    </DashboardLayout>
  );
}