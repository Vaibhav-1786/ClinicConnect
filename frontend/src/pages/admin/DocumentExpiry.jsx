import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function DocumentExpiry() {
  const [buckets, setBuckets] = useState({ expired: [], expiring_soon: [], valid: [] });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [dates, setDates] = useState({ issue_date: "", expiry_date: "" });
  const { showToast } = useToast();
  const { t } = useLanguage();

  const SECTIONS = [
    { key: "expired", label: t("adminExpiry.expired"), badge: "CANCELLED" },
    { key: "expiring_soon", label: t("adminExpiry.expiringSoon"), badge: "PENDING" },
    { key: "valid", label: t("adminExpiry.valid"), badge: "CONFIRMED" },
  ];

  const load = () => {
    setLoading(true);
    api.get("/admin/document-expiry").then((r) => setBuckets(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const startEdit = (doc) => {
    setEditing(doc.id);
    setDates({ issue_date: doc.issue_date || "", expiry_date: doc.expiry_date || "" });
  };

  const save = async (docId) => {
    try {
      await api.put(`/admin/documents/${docId}/expiry`, dates);
      showToast(t("adminExpiry.updated"), "success");
      setEditing(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("adminExpiry.updateFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("adminExpiry.title")}>
      <div className="card">
        <p style={{ color: "var(--text-muted)" }}>{t("adminExpiry.hint")}</p>
      </div>

      {loading ? (
        <div className="card"><div className="empty-state">{t("common.loading")}</div></div>
      ) : (
        SECTIONS.map((s) => (
          <div className="card" key={s.key}>
            <h3>{s.label} ({buckets[s.key]?.length || 0})</h3>
            {(!buckets[s.key] || buckets[s.key].length === 0) ? (
              <div className="empty-state">{t("docHistory.none")}</div>
            ) : (
              <div className="table-wrap"><table>
                <thead><tr><th>{t("dashboard.doctor")}</th><th>{t("adminExpiry.document")}</th><th>{t("adminExpiry.issueDate")}</th><th>{t("adminExpiry.expiryDate")}</th><th>{t("adminExpiry.days")}</th><th>{t("adminExpiry.verification")}</th><th>{t("common.actions")}</th></tr></thead>
                <tbody>
                  {buckets[s.key].map((doc) => (
                    <tr key={doc.id}>
                      <td>Dr. {doc.full_name} <span style={{ color: "var(--text-muted)" }}>({doc.doctor_code})</span></td>
                      <td>{doc.doc_type.replace(/_/g, " ")}</td>
                      {editing === doc.id ? (
                        <>
                          <td><input type="date" className="input" value={dates.issue_date} onChange={(e) => setDates({ ...dates, issue_date: e.target.value })} /></td>
                          <td><input type="date" className="input" value={dates.expiry_date} onChange={(e) => setDates({ ...dates, expiry_date: e.target.value })} /></td>
                          <td colSpan={2}>
                            <button className="btn small" onClick={() => save(doc.id)}>{t("adminExpiry.save")}</button>
                            <button className="btn small secondary" style={{ marginLeft: 6 }} onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{doc.issue_date || "—"}</td>
                          <td>{doc.expiry_date}</td>
                          <td>{doc.days_until_expiry >= 0 ? t("adminExpiry.daysLeft").replace("{n}", doc.days_until_expiry) : t("adminExpiry.daysAgo").replace("{n}", Math.abs(doc.days_until_expiry))}</td>
                        </>
                      )}
                      {editing !== doc.id && (
                        <>
                          <td><span className={`badge ${doc.verification_status === "APPROVED" ? "CONFIRMED" : "PENDING"}`}>{doc.verification_status}</span></td>
                          <td>
                            <button className="btn small secondary" onClick={() => startEdit(doc)}>{t("adminExpiry.editDates")}</button>
                            <Link to="/admin/doctors" className="btn small secondary" style={{ marginLeft: 6, textDecoration: "none" }}>{t("adminExpiry.reviewDoctor")}</Link>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        ))
      )}
    </DashboardLayout>
  );
}
