import React, { useEffect, useState } from "react";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function AdminProductivity() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get("/admin/productivity/leaderboard").then((r) => {
      setEnabled(r.data.enabled);
      setRows(r.data.rows);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const toggle = async () => {
    await api.put("/admin/productivity/settings", { is_enabled: !enabled });
    showToast(!enabled ? t("productivity.enabled") : t("productivity.disabled"), "success");
    load();
  };

  const badgeFor = (row, rows) => {
    const badges = [];
    if (row.applications_processed === Math.max(...rows.map((r) => r.applications_processed))) badges.push(t("productivity.badgeMostApplications"));
    if (row.avg_review_minutes === Math.min(...rows.map((r) => r.avg_review_minutes ?? Infinity))) badges.push(t("productivity.badgeFastest"));
    if (row.accuracy_pct === Math.max(...rows.map((r) => r.accuracy_pct ?? 0))) badges.push(t("productivity.badgeMostEfficient"));
    return badges;
  };

  return (
    <DashboardLayout title={t("productivity.title")}>
      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: "var(--text-muted)" }}>{t("productivity.hint")}</p>
        <button className="btn btn-outline btn-sm" onClick={toggle}>
          {enabled ? t("productivity.disable") : t("productivity.enable")}
        </button>
      </div>

      {loading ? (
        <div className="card"><div className="empty-state">{t("common.loading")}</div></div>
      ) : !enabled ? (
        <div className="card"><div className="empty-state">{t("productivity.disabledState")}</div></div>
      ) : rows.length === 0 ? (
        <div className="card"><div className="empty-state">{t("productivity.none")}</div></div>
      ) : (
        <div className="card">
          <h3>{t("productivity.thisMonth")}</h3>
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>{t("common.name")}</th><th>{t("productivity.applications")}</th><th>{t("productivity.approved")}</th>
                <th>{t("productivity.accuracy")}</th><th>{t("productivity.avgTime")}</th><th>{t("productivity.badges")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.admin_id}>
                  <td>{r.email}</td>
                  <td>{r.applications_processed}</td>
                  <td>{r.approved}</td>
                  <td>{r.accuracy_pct != null ? `${r.accuracy_pct}%` : "—"}</td>
                  <td>{r.avg_review_minutes != null ? `${r.avg_review_minutes} ${t("productivity.minutes")}` : "—"}</td>
                  <td>{badgeFor(r, rows).map((b) => <span className="pill pill-success" key={b} style={{ marginRight: 4 }}>🏆 {b}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </DashboardLayout>
  );
}
