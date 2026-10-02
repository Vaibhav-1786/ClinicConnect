import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";

export default function DoctorDashboard() {
  const [stats, setStats] = useState(null);
  const [today, setToday] = useState([]);
  const [fee, setFee] = useState(null);          // saved value from the backend
  const [feeInput, setFeeInput] = useState("");  // what the doctor is typing
  const [feeLoading, setFeeLoading] = useState(true);
  const [savingFee, setSavingFee] = useState(false);
  const { t } = useLanguage();
  const { showToast } = useToast();

  // Always read the fee back from the doctor's own profile — the backend
  // (doctors.consultation_fee) stays the single source of truth.
  const loadFee = async () => {
    try {
      const res = await api.get("/doctors/profile");
      const current = res.data?.consultation_fee;
      const value = current == null ? 0 : Number(current);
      setFee(value);
      setFeeInput(String(value));
    } catch (err) {
      setFee(null);
      showToast(
        err.response?.data?.error || t("docFee.loadFailed", "Could not load your consultation fee"),
        "error"
      );
    } finally {
      setFeeLoading(false);
    }
  };

  useEffect(() => {
    api.get("/reports/doctor/summary").then((r) => setStats(r.data)).catch(() => {});
    const todayStr = new Date().toISOString().slice(0, 10);
    api.get(`/appointments/doctor?date=${todayStr}`).then((r) => setToday(r.data)).catch(() => {});
    loadFee();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveFee = async () => {
    const raw = String(feeInput).trim();
    if (raw === "") {
      showToast(t("docFee.required", "Please enter a consultation fee"), "error");
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      showToast(t("docFee.notNumeric", "Consultation fee must be a valid number"), "error");
      return;
    }
    if (value < 0) {
      showToast(t("docFee.negative", "Consultation fee cannot be negative"), "error");
      return;
    }
    setSavingFee(true);
    try {
      // Reuses the existing doctor profile API; the token identifies the
      // doctor, so this can only ever update the logged-in doctor's own fee.
      await api.put("/doctors/profile", { consultation_fee: Number(value.toFixed(2)) });
      showToast(t("docFee.saved", "Consultation fee updated"), "success");
      await loadFee(); // refresh from the backend so the shown value is authoritative
    } catch (err) {
      showToast(
        err.response?.data?.error || t("docFee.saveFailed", "Could not update consultation fee"),
        "error"
      );
    } finally {
      setSavingFee(false);
    }
  };

  return (
    <DashboardLayout title={t("dashboard.doctorTitle")}>
      <div className="grid grid-4">
        <div className="card stat-card"><div className="value">{stats?.todays_patients ?? "-"}</div><div className="label">{t("dashboard.todaysPatients")}</div></div>
        <div className="card stat-card"><div className="value">{stats?.waiting_in_queue ?? "-"}</div><div className="label">{t("commandCenter.waitingPatients")}</div></div>
        <div className="card stat-card"><div className="value">{stats?.completed_today ?? "-"}</div><div className="label">{t("dashboard.completed")}</div></div>
        <div className="card stat-card"><div className="value">{stats?.pending_appointments ?? "-"}</div><div className="label">{t("dashboard.pending")}</div></div>
        <div className="card stat-card"><div className="value">{stats?.pending_followups ?? "-"}</div><div className="label">{t("dashboard.followUps")}</div></div>
        <div className="card stat-card"><div className="value">{stats?.avg_consultation_minutes != null ? `${stats.avg_consultation_minutes} min` : "-"}</div><div className="label">{t("commandCenter.avgConsultation")}</div></div>
      </div>

      <div className="card">
        <h3>{t("docFee.title", "Consultation Fee")}</h3>
        <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
          {t("docFee.currentFee", "Current fee")}:{" "}
          <strong>{feeLoading ? "…" : fee == null ? "—" : `₹${Number(fee).toFixed(2)}`}</strong>
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label htmlFor="consultation-fee">{t("docFee.label", "Consultation Fee")} (₹)</label>
            <input
              id="consultation-fee"
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={feeInput}
              disabled={feeLoading || savingFee}
              onChange={(e) => setFeeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveFee(); }}
              style={{ maxWidth: 180 }}
            />
          </div>
          <button
            className="btn"
            onClick={saveFee}
            disabled={feeLoading || savingFee}
            style={{ marginBottom: 12 }}
          >
            {savingFee ? t("common.saving", "Saving…") : t("docFee.update", "Update Fee")}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          {t("docFee.helper", "This fee will be displayed to patients and automatically used by receptionists when generating consultation bills.")}
        </p>
      </div>

      <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link className="btn small" to="/doctor/appointments">{t("commandCenter.quickStartConsultation")}</Link>
        <Link className="btn small secondary" to="/doctor/queue">{t("nav.todaysQueue")}</Link>
        <Link className="btn small secondary" to="/doctor/patient-history">{t("nav.patientHistory")}</Link>
      </div>

      <div className="card">
        <h3>{t("dashboard.todaysAppointments")}</h3>
        {today.length === 0 ? <div className="empty-state">{t("dashboard.noAppointmentsToday")}</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("common.time")}</th><th>{t("dashboard.patient")}</th><th>{t("dashboard.clinic")}</th><th>{t("common.status")}</th><th></th></tr></thead>
            <tbody>
              {today.map((a) => (
                <tr key={a.id}>
                  <td>{String(a.appointment_time).slice(0,5)}</td>
                  <td>{a.patient_name} ({a.patient_code})</td>
                  <td>{a.clinic_name}</td>
                  <td><span className={`badge ${a.status}`}>{a.status}</span></td>
                  <td><Link className="btn small" to="/doctor/appointments">{t("dashboard.open")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </DashboardLayout>
  );
}