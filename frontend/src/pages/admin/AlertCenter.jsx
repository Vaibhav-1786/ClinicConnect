import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const SEVERITY_ICON = { URGENT: "🔴", ATTENTION: "🟡", INFORMATION: "🟢" };
const SEVERITY_ORDER = ["URGENT", "ATTENTION", "INFORMATION"];

export default function AdminAlertCenter() {
  const [alerts, setAlerts] = useState({ URGENT: [], ATTENTION: [], INFORMATION: [] });
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => {
    setLoading(true);
    api.get("/admin/alerts").then((r) => setAlerts(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const resolve = async (id) => {
    await api.post(`/admin/alerts/${id}/resolve`);
    showToast(t("alertCenter.resolved"), "success");
    load();
  };

  const markRead = async (id) => {
    await api.post(`/admin/alerts/${id}/read`);
    load();
  };

  const total = SEVERITY_ORDER.reduce((sum, s) => sum + alerts[s].length, 0);

  return (
    <DashboardLayout title={t("alertCenter.title")}>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{t("alertCenter.actionRequired")}</h3>
        <p style={{ fontSize: 28, fontWeight: 700 }}>{total}</p>
      </div>

      {loading ? (
        <div className="card"><div className="empty-state">{t("common.loading")}</div></div>
      ) : (
        SEVERITY_ORDER.map((sev) => (
          <div className="card" key={sev} style={{ marginBottom: 16 }}>
            <h3>{SEVERITY_ICON[sev]} {t(`alertCenter.severity.${sev}`)} ({alerts[sev].length})</h3>
            {alerts[sev].length === 0 ? (
              <div className="empty-state">{t("alertCenter.none")}</div>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {alerts[sev].map((a) => (
                  <li key={a.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div onClick={() => !a.is_read && markRead(a.id)}>
                      <p style={{ fontWeight: a.is_read ? 400 : 700, margin: 0 }}>{a.title}</p>
                      {a.description && <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "2px 0" }}>{a.description}</p>}
                      <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>{new Date(a.created_at).toLocaleString()}</p>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {a.action_url && a.action_label && (
                        <Link className="btn btn-outline btn-sm" to={a.action_url}>{a.action_label}</Link>
                      )}
                      <button className="btn btn-outline btn-sm" onClick={() => resolve(a.id)}>{t("alertCenter.resolve")}</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
    </DashboardLayout>
  );
}
