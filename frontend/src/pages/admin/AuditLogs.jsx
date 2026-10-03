import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useLanguage } from "../../context/LanguageContext";

const ROLES = ["", "patient", "doctor", "receptionist", "admin"];

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [modules, setModules] = useState([]);
  const [filters, setFilters] = useState({ role: "", module: "", action: "", date_from: "", date_to: "" });
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => { api.get("/admin/audit-logs/modules").then((r) => setModules(r.data)).catch(() => {}); }, []);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page, page_size: pageSize });
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    api.get(`/admin/audit-logs?${params.toString()}`).then((r) => {
      setLogs(r.data.logs);
      setTotal(r.data.total);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [page, filters]);

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <DashboardLayout title={t("adminAudit.title")}>
      <div className="card">
        <p style={{ color: "var(--text-muted)" }}>{t("adminAudit.readOnly")}</p>
        <div className="grid grid-3">
          <div>
            <label>{t("adminAudit.role")}</label>
            <select value={filters.role} onChange={(e) => { setFilters({ ...filters, role: e.target.value }); setPage(1); }}>
              {ROLES.map((r) => <option key={r} value={r}>{r || t("adminAudit.allRoles")}</option>)}
            </select>
          </div>
          <div>
            <label>{t("adminAudit.module")}</label>
            <select value={filters.module} onChange={(e) => { setFilters({ ...filters, module: e.target.value }); setPage(1); }}>
              <option value="">{t("adminAudit.allModules")}</option>
              {modules.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label>{t("adminAudit.actionContains")}</label>
            <input className="input" value={filters.action} onChange={(e) => { setFilters({ ...filters, action: e.target.value }); setPage(1); }} placeholder="e.g. CANCELLED" />
          </div>
          <div>
            <label>{t("patHealthTimeline.from")}</label>
            <input type="date" className="input" value={filters.date_from} onChange={(e) => { setFilters({ ...filters, date_from: e.target.value }); setPage(1); }} />
          </div>
          <div>
            <label>{t("patHealthTimeline.to")}</label>
            <input type="date" className="input" value={filters.date_to} onChange={(e) => { setFilters({ ...filters, date_to: e.target.value }); setPage(1); }} />
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : logs.length === 0 ? (
          <div className="empty-state">{t("adminAudit.noMatching")}</div>
        ) : (
          <>
            <div className="table-wrap"><table>
              <thead><tr><th>{t("adminAudit.timestamp")}</th><th>{t("adminAudit.user")}</th><th>{t("adminAudit.role")}</th><th>{t("adminAudit.module")}</th><th>{t("adminAudit.action")}</th><th>{t("docHistory.organization")}</th><th>{t("recBilling.description")}</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.created_at).toLocaleString()}</td>
                    <td>{l.email || "—"}</td>
                    <td><span className="pill">{l.role}</span></td>
                    <td>{l.module || "—"}</td>
                    <td>{l.action}</td>
                    <td>{l.clinic_name || "—"}</td>
                    <td>{l.description}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
                {t("adminAudit.pageOf").replace("{page}", page).replace("{total}", totalPages).replace("{count}", total)}
              </span>
              <div>
                <button className="btn small secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("adminAudit.previous")}</button>
                <button className="btn small secondary" style={{ marginLeft: 6 }} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{t("adminAudit.next")}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
