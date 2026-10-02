import React, { useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";
import DocumentVersionHistory from "../../components/DocumentVersionHistory";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const ORG_LABEL = (row) => `${row.clinic_name}${row.org_type ? ` (${row.org_type})` : ""}`;

export default function PatientHistory() {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState([]);
  const [history, setHistory] = useState(null);
  const [profile360, setProfile360] = useState(null);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const search = async () => {
    if (q.trim().length < 2) return;
    const res = await api.get(`/search?q=${encodeURIComponent(q.trim())}`);
    setMatches(res.data.patients || []);
    setHistory(null);
  };

  const selectPatient = async (patientId) => {
    setLoading(true);
    try {
      const res = await api.get(`/doctor/patient-history/${patientId}`);
      setHistory(res.data);
      setMatches([]);
      api.get(`/patients/${patientId}/profile-360`).then((r) => setProfile360(r.data)).catch(() => setProfile360(null));
    } catch (err) {
      showToast(err.response?.data?.error || t("docHistory.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout title={t("nav.patientHistory")}>
      <div className="card">
        <p style={{ color: "var(--text-muted)" }}>{t("docHistory.hint")}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" style={{ margin: 0 }} placeholder={t("docHistory.searchPlaceholder")}
                 value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <button className="btn small" onClick={search}>{t("common.search")}</button>
        </div>
        {matches.length > 0 && (
          <ul style={{ marginTop: 10 }}>
            {matches.map((p) => (
              <li key={p.id} style={{ padding: "6px 0", cursor: "pointer" }} onClick={() => selectPatient(p.id)}>
                <a>{p.full_name} ({p.patient_code})</a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {loading && <div className="card"><div className="empty-state">{t("docHistory.loadingHistory")}</div></div>}

      {history && (
        <>
          <div className="card">
            <h3>{history.patient.full_name} <span className="pill">{history.patient.patient_code}</span></h3>
            <p style={{ color: "var(--text-muted)" }}>
              {history.patient.gender}, {t("patFamily.dob")} {history.patient.dob}
              {history.patient.blood_group ? ` · ${t("patFamily.bloodGroup")} ${history.patient.blood_group}` : ""}
              {history.patient.allergies ? ` · ${t("patFamily.allergies")}: ${history.patient.allergies}` : ""}
            </p>
            {profile360 && (
              <div className="grid grid-4" style={{ marginTop: 10 }}>
                <div className="card stat-card" style={{ padding: 10 }}>
                  <div className="value" style={{ fontSize: 20 }}>{profile360.summary.active_medication_count}</div>
                  <div className="label">{t("profile360.activeMeds")}</div>
                </div>
                <div className="card stat-card" style={{ padding: 10 }}>
                  <div className="value" style={{ fontSize: 20 }}>{profile360.summary.last_visit_date || "—"}</div>
                  <div className="label">{t("profile360.lastVisit")}</div>
                </div>
                <div className="card stat-card" style={{ padding: 10 }}>
                  <div className="value" style={{ fontSize: 20 }}>{profile360.summary.next_appointment_date || "—"}</div>
                  <div className="label">{t("profile360.nextAppointment")}</div>
                </div>
                <div className="card stat-card" style={{ padding: 10 }}>
                  <div className="value" style={{ fontSize: 20 }}>₹{profile360.summary.outstanding_balance}</div>
                  <div className="label">{t("profile360.outstandingBalance")}</div>
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn small" to="/doctor/appointments">{t("docQueue.startConsultation")}</Link>
            <button className="btn small secondary" onClick={() => window.print()}>{t("profile360.print")}</button>
          </div>

          <div className="card">
            <h3>{t("nav.appointments")} ({history.appointments.length})</h3>
            {history.appointments.length === 0 ? <div className="empty-state">{t("docHistory.none")}</div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>{t("common.date")}</th><th>{t("dashboard.doctor")}</th><th>{t("docHistory.organization")}</th><th>{t("common.status")}</th><th>{t("docHistory.reason")}</th></tr></thead>
                <tbody>
                  {history.appointments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.appointment_date} {String(a.appointment_time).slice(0,5)}</td>
                      <td>Dr. {a.doctor_name}</td>
                      <td><span className="pill">{ORG_LABEL(a)}</span></td>
                      <td><span className="badge CONFIRMED">{a.status}</span></td>
                      <td>{a.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>

          <div className="card">
            <h3>{t("nav.prescriptions")} ({history.prescriptions.length})</h3>
            {history.prescriptions.length === 0 ? <div className="empty-state">{t("docHistory.none")}</div> : (
              history.prescriptions.map((p) => (
                <div key={p.id} style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                  <strong>{p.prescription_date}</strong> — Dr. {p.doctor_name} <span className="pill">{ORG_LABEL(p)}</span>
                  <p style={{ margin: "4px 0" }}>{p.diagnosis_text}</p>
                  <p style={{ margin: 0, color: "var(--text-muted)" }}>{p.medicines.map((m) => `${m.name} (${m.dosage})`).join(", ")}</p>
                </div>
              ))
            )}
          </div>

          <div className="card">
            <h3>{t("docHistory.vitals")} ({history.vitals.length})</h3>
            {history.vitals.length === 0 ? <div className="empty-state">{t("docHistory.none")}</div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>{t("common.date")}</th><th>{t("docHistory.bp")}</th><th>{t("docHistory.pulse")}</th><th>{t("docHistory.spo2")}</th><th>{t("docHistory.weight")}</th><th>{t("docHistory.organization")}</th></tr></thead>
                <tbody>
                  {history.vitals.map((v) => (
                    <tr key={v.id}>
                      <td>{String(v.recorded_at).slice(0,10)}</td>
                      <td>{v.blood_pressure || "—"}</td><td>{v.pulse || "—"}</td><td>{v.spo2 || "—"}</td>
                      <td>{v.weight_kg || "—"}</td><td>{v.clinic_name ? <span className="pill">{ORG_LABEL(v)}</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>

          <div className="card">
            <h3>{t("docHistory.consultationNotes")} ({history.consultation_notes.length})</h3>
            {history.consultation_notes.length === 0 ? <div className="empty-state">{t("docHistory.none")}</div> : (
              history.consultation_notes.map((n) => (
                <div key={n.id} style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                  <strong>{String(n.updated_at).slice(0,10)}</strong> — Dr. {n.doctor_name} <span className="pill">{ORG_LABEL(n)}</span> <span className="pill">{n.source}</span>
                  {n.chief_complaint && <p style={{ margin: "4px 0" }}><b>{t("docHistory.ccAbbrev")}:</b> {n.chief_complaint}</p>}
                  {n.assessment && <p style={{ margin: "4px 0" }}><b>{t("docNotes.assessment")}:</b> {n.assessment}</p>}
                  {n.plan && <p style={{ margin: "4px 0" }}><b>{t("docNotes.plan")}:</b> {n.plan}</p>}
                </div>
              ))
            )}
          </div>

          <div className="card">
            <h3>{t("docHistory.labReports")} ({history.lab_reports.length})</h3>
            {history.lab_reports.length === 0 ? <div className="empty-state">{t("docHistory.none")}</div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>{t("common.date")}</th><th>{t("docHistory.test")}</th><th>{t("docHistory.result")}</th><th>{t("dashboard.doctor")}</th><th>{t("docHistory.organization")}</th></tr></thead>
                <tbody>
                  {history.lab_reports.map((l) => (
                    <tr key={l.id}>
                      <td>{String(l.reported_at).slice(0,10)}</td><td>{l.test_name}</td><td>{l.result_value}</td>
                      <td>Dr. {l.doctor_name}</td><td><span className="pill">{ORG_LABEL(l)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>

          <div className="card">
            <h3>{t("docHistory.followUps")} ({history.followups.length})</h3>
            {history.followups.length === 0 ? <div className="empty-state">{t("docHistory.none")}</div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>{t("common.date")}</th><th>{t("docHistory.reason")}</th><th>{t("common.status")}</th><th>{t("dashboard.doctor")}</th><th>{t("docHistory.organization")}</th></tr></thead>
                <tbody>
                  {history.followups.map((f) => (
                    <tr key={f.id}>
                      <td>{f.followup_date}</td><td>{f.reason}</td><td>{f.status}</td>
                      <td>Dr. {f.doctor_name}</td><td><span className="pill">{ORG_LABEL(f)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>

          {profile360 && (
            <>
              <div className="card">
                <h3>{t("profile360.documents")} ({profile360.documents.length})</h3>
                {profile360.documents.length === 0 ? <div className="empty-state">{t("docHistory.none")}</div> : (
                  <div className="table-wrap"><table>
                    <thead><tr><th>{t("profile360.documentType")}</th><th>{t("common.date")}</th><th>{t("common.status")}</th><th></th></tr></thead>
                    <tbody>
                      {profile360.documents.map((d) => (
                        <tr key={d.id}>
                          <td>{d.doc_type}{d.version_number > 1 ? ` (v${d.version_number})` : ""}</td>
                          <td>{String(d.created_at).slice(0,10)}</td>
                          <td>{d.status || "—"}</td>
                          <td><DocumentVersionHistory documentId={d.id} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </div>
              <div className="card">
                <h3>{t("profile360.payments")} ({profile360.payments.length})</h3>
                {profile360.payments.length === 0 ? <div className="empty-state">{t("docHistory.none")}</div> : (
                  <div className="table-wrap"><table>
                    <thead><tr><th>{t("common.date")}</th><th>{t("profile360.invoiceNumber")}</th><th>₹</th><th>{t("common.status")}</th></tr></thead>
                    <tbody>
                      {profile360.payments.map((inv) => (
                        <tr key={inv.id}>
                          <td>{String(inv.created_at).slice(0,10)}</td><td>{inv.invoice_number}</td>
                          <td>{inv.total_amount}</td><td><span className={`badge ${inv.payment_status}`}>{inv.payment_status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </DashboardLayout>
  );
}
