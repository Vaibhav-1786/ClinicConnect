import React, { useEffect, useState } from "react";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function AdminPermissions() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [catalog, setCatalog] = useState({ permissions: [], role_defaults: {} });
  const [userIdInput, setUserIdInput] = useState("");
  const [userData, setUserData] = useState(null);

  useEffect(() => { api.get("/admin/permissions").then((r) => setCatalog(r.data)); }, []);

  const lookupUser = async () => {
    if (!userIdInput) return;
    try {
      const res = await api.get(`/admin/permissions/users/${userIdInput}`);
      setUserData(res.data);
    } catch (err) {
      showToast(err.response?.data?.error || t("adminPermissions.userNotFound"), "error");
      setUserData(null);
    }
  };

  const setOverride = async (permission_key, granted) => {
    await api.put(`/admin/permissions/users/${userData.user.id}`, { permission_key, granted });
    showToast(t("adminPermissions.saved"), "success");
    const res = await api.get(`/admin/permissions/users/${userData.user.id}`);
    setUserData(res.data);
  };

  const overrideFor = (key) => userData?.overrides.find((o) => o.permission_key === key);
  const roleDefaultHas = (key) => userData && (catalog.role_defaults[userData.user.role] || []).includes(key);

  const grouped = catalog.permissions.reduce((acc, p) => {
    acc[p.category] = acc[p.category] || [];
    acc[p.category].push(p);
    return acc;
  }, {});

  return (
    <DashboardLayout title={t("nav.permissions")}>
      <div className="card">
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("adminPermissions.intro")}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" style={{ maxWidth: 220 }} placeholder={t("adminPermissions.userIdPlaceholder")}
                 value={userIdInput} onChange={(e) => setUserIdInput(e.target.value)} />
          <button className="btn small" onClick={lookupUser}>{t("common.search")}</button>
        </div>
      </div>

      {userData && (
        <div className="card">
          <h3>{userData.user.email} <span className="pill">{userData.user.role}</span></h3>
          {Object.entries(grouped).map(([category, perms]) => (
            <div key={category} style={{ marginTop: 14 }}>
              <h4 style={{ textTransform: "capitalize" }}>{category}</h4>
              {perms.map((p) => {
                const override = overrideFor(p.permission_key);
                const effective = userData.effective_permissions.includes(p.permission_key);
                return (
                  <div key={p.permission_key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontSize: 13.5 }}>{p.description}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {p.permission_key} · {t("adminPermissions.roleDefault")}: {roleDefaultHas(p.permission_key) ? t("common.yes") : t("common.no")}
                        {override ? ` · ${t("adminPermissions.overridden")}: ${override.granted ? t("common.yes") : t("common.no")}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span className={`pill ${effective ? "pill-success" : "pill-danger"}`}>
                        {effective ? t("adminPermissions.granted") : t("adminPermissions.denied")}
                      </span>
                      <button className="btn btn-outline btn-sm" onClick={() => setOverride(p.permission_key, true)}>{t("adminPermissions.grant")}</button>
                      <button className="btn btn-outline btn-sm" onClick={() => setOverride(p.permission_key, false)}>{t("adminPermissions.revoke")}</button>
                      {override && (
                        <button className="btn btn-outline btn-sm" onClick={() => setOverride(p.permission_key, null)}>{t("adminPermissions.reset")}</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
