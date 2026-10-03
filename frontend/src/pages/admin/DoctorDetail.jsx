import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import ProgressBar from "../../components/ProgressBar";
import AdminComments from "../../components/AdminComments";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

const CATEGORY_PILL = {
  EXCELLENT: "pill-success", GOOD: "pill-success",
  NEEDS_ATTENTION: "pill-warning", CRITICAL: "pill-danger",
};

function DayLabel({ n, t }) {
  const days = [t("days.mon"), t("days.tue"), t("days.wed"), t("days.thu"), t("days.fri"), t("days.sat"), t("days.sun")];
  return days[n] ?? n;
}

export default function AdminDoctorDetail() {
  const { id } = useParams();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const [doctor, setDoctor] = useState(null);
  const [score, setScore] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [qr, setQr] = useState(null);
  const [schedule, setSchedule] = useState({ schedule: [], conflicts: [] });
  const [recommendations, setRecommendations] = useState([]);
  const [loadingReco, setLoadingReco] = useState(false);

  const load = () => {
    api.get("/admin/doctors", { params: { search: "" } }).then((r) => {
      const found = r.data.find((d) => String(d.id) === String(id));
      setDoctor(found || null);
    });
    api.get(`/admin/doctors/${id}/performance-score`).then((r) => setScore(r.data)).catch(() => {});
    api.get(`/admin/doctors/${id}/schedule`).then((r) => setSchedule(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, [id]);

  const loadQr = () => {
    api.get(`/admin/doctors/${id}/qr-profile`).then((r) => setQr(r.data)).catch((err) => {
      showToast(err.response?.data?.error || t("doctorDetail.qrFailed"), "error");
    });
  };

  const regenerateQr = async () => {
    if (!window.confirm(t("doctorDetail.confirmRegenerate"))) return;
    const res = await api.post(`/admin/doctors/${id}/qr-profile/regenerate`);
    setQr(res.data);
    showToast(t("doctorDetail.qrRegenerated"), "success");
  };

  const downloadQr = () => {
    if (!qr) return;
    const blob = new Blob([qr.qr_svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `doctor-${id}-qr.svg`; a.click();
    URL.revokeObjectURL(url);
  };

  const recompute = async () => {
    const res = await api.post(`/admin/doctors/${id}/performance-score/recompute`);
    setScore({ current: { ...res.data, score_date: new Date().toISOString().slice(0, 10) }, previous: score?.current, score_change: null, history: score?.history || [] });
    showToast(t("doctorDetail.scoreRecomputed"), "success");
    load();
  };

  const loadRecommendations = async () => {
    setLoadingReco(true);
    try {
      const res = await api.get(`/admin/doctors/${id}/recommended-organizations`);
      setRecommendations(res.data.recommendations);
    } finally {
      setLoadingReco(false);
    }
  };

  const resolveConflict = async (availabilityId) => {
    if (!window.confirm(t("doctorDetail.confirmResolveConflict"))) return;
    await api.post(`/admin/doctors/${id}/schedule/${availabilityId}/resolve-conflict`);
    showToast(t("doctorDetail.conflictResolved"), "success");
    load();
  };

  if (!doctor) return <DashboardLayout title={t("doctorDetail.title")}><p>{t("common.loading")}</p></DashboardLayout>;

  const current = score?.current;

  return (
    <DashboardLayout title={`${doctor.full_name} — ${t("doctorDetail.title")}`}>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{doctor.full_name} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({doctor.doctor_code})</span></h3>
        <p>{doctor.specialization}</p>
        <span className={`pill ${doctor.verification_status === "APPROVED" ? "pill-success" : "pill-warning"}`}>{doctor.verification_status}</span>
      </div>

      {/* Performance Score — feature 4 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{t("doctorDetail.performanceScore")}</h3>
        {current ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ fontSize: 36, fontWeight: 700 }}>{current.overall_score} <span style={{ fontSize: 16, color: "var(--text-muted)" }}>/ 100</span></div>
              <span className={`pill ${CATEGORY_PILL[current.category] || ""}`}>{t(`doctorDetail.category.${current.category}`)}</span>
              {score.score_change !== null && score.score_change !== undefined && (
                <span style={{ color: score.score_change >= 0 ? "var(--success-soft-text)" : "var(--danger-soft-text)" }}>
                  {score.score_change >= 0 ? "↑" : "↓"} {Math.abs(score.score_change)} {t("doctorDetail.pointsThisPeriod")}
                </span>
              )}
              <button className="btn btn-outline btn-sm" onClick={() => setShowBreakdown((v) => !v)}>{t("doctorDetail.viewCalculation")}</button>
              <button className="btn btn-outline btn-sm" onClick={recompute}>{t("doctorDetail.recompute")}</button>
            </div>

            {showBreakdown && (
              <div className="table-wrap"><table style={{ marginTop: 12 }}>
                <thead><tr><th>{t("doctorDetail.metric")}</th><th>{t("doctorDetail.score")}</th></tr></thead>
                <tbody>
                  <tr><td>{t("doctorDetail.completion")}</td><td>{current.completion_score}</td></tr>
                  <tr><td>{t("doctorDetail.cancellation")}</td><td>{current.cancellation_score}</td></tr>
                  <tr><td>{t("doctorDetail.feedback")}</td><td>{current.feedback_score}</td></tr>
                  <tr><td>{t("doctorDetail.responseTime")}</td><td>{current.response_time_score}</td></tr>
                  <tr><td>{t("doctorDetail.profileCompleteness")}</td><td>{current.profile_completeness_score}</td></tr>
                  <tr><td>{t("doctorDetail.documentVerification")}</td><td>{current.document_verification_score}</td></tr>
                  <tr><td>{t("doctorDetail.patientRetention")}</td><td>{current.patient_retention_score}</td></tr>
                </tbody>
              </table></div>
            )}

            {score.history && score.history.length > 1 && (
              <div style={{ height: 220, marginTop: 16 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={score.history}>
                    <XAxis dataKey="score_date" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="overall_score" stroke="#2563eb" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        ) : <div className="empty-state">{t("common.loading")}</div>}
      </div>

      {/* QR Profile — feature 11 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{t("doctorDetail.qrProfile")}</h3>
        {!qr ? (
          <button className="btn btn-outline btn-sm" onClick={loadQr}>{t("doctorDetail.generateQr")}</button>
        ) : (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ width: 160, height: 160, background: "#fff", padding: 8, border: "1px solid var(--border)" }}
                 dangerouslySetInnerHTML={{ __html: qr.qr_svg }} />
            <div>
              <p style={{ wordBreak: "break-all" }}>{qr.public_url}</p>
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("doctorDetail.regeneratedCount")}: {qr.regenerated_count}</p>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-outline btn-sm" onClick={downloadQr}>{t("doctorDetail.download")}</button>
                <button className="btn btn-outline btn-sm" onClick={() => window.print()}>{t("doctorDetail.print")}</button>
                <button className="btn btn-outline btn-sm" onClick={regenerateQr}>{t("doctorDetail.regenerate")}</button>
                <a className="btn btn-outline btn-sm" href={qr.public_url} target="_blank" rel="noreferrer">{t("doctorDetail.preview")}</a>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Multi-clinic schedule + conflicts — feature 8 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{t("doctorDetail.weeklySchedule")}</h3>
        {schedule.conflicts.length > 0 && (
          <div style={{ background: "var(--danger-soft)", color: "var(--danger-soft-text)", padding: 10, borderRadius: 6, marginBottom: 10 }}>
            {schedule.conflicts.map((c, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                ⚠️ {t("doctorDetail.conflictDetected")}: <strong>{c.a.clinic_name}</strong> (<DayLabel n={c.a.day_of_week} t={t} /> {c.a.start_time}–{c.a.end_time}) vs <strong>{c.b.clinic_name}</strong> (<DayLabel n={c.b.day_of_week} t={t} /> {c.b.start_time}–{c.b.end_time})
                <button className="btn btn-outline btn-sm" style={{ marginLeft: 10 }} onClick={() => resolveConflict(c.b.id)}>{t("doctorDetail.deactivateSecond")}</button>
              </div>
            ))}
          </div>
        )}
        {schedule.schedule.length === 0 ? <div className="empty-state">{t("doctorDetail.noSchedule")}</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("nav.clinics")}</th><th>{t("common.date")}</th><th>{t("common.time")}</th><th>{t("doctorDetail.type")}</th></tr></thead>
            <tbody>
              {schedule.schedule.map((s) => (
                <tr key={s.id}>
                  <td>{s.clinic_name}</td>
                  <td><DayLabel n={s.day_of_week} t={t} /></td>
                  <td>{s.start_time}–{s.end_time}</td>
                  <td>{s.consultation_type}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {/* Recommended Organizations — features 1 & 18 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{t("doctorDetail.recommendedOrgs")}</h3>
        <button className="btn btn-outline btn-sm" onClick={loadRecommendations} disabled={loadingReco}>
          {loadingReco ? t("common.loading") : t("doctorDetail.findMatches")}
        </button>
        {recommendations.length > 0 && (
          <div className="card-grid" style={{ marginTop: 12 }}>
            {recommendations.map((r, i) => (
              <div className="card" key={r.clinic_id}>
                <h4>{["🥇", "🥈", "🥉"][i] || "•"} {r.clinic_name}</h4>
                <p style={{ fontWeight: 700, fontSize: 20 }}>{r.match_score}% {t("doctorDetail.match")}</p>
                {r.distance_km != null && <p>{r.distance_km} km</p>}
                <p>{t("doctorDetail.currentDoctors")}: {r.current_doctors}</p>
                <ul style={{ fontSize: 13, color: "var(--text-muted)", paddingLeft: 18 }}>
                  {r.reasons.map((reason, ri) => <li key={ri}>{reason}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <AdminComments entityType="DOCTOR" entityId={id} />
    </DashboardLayout>
  );
}