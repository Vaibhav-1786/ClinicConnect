import React, { useEffect, useState } from "react";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function DoctorOrganizations() {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const { clinic, switchClinic } = useAuth();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => {
    setLoading(true);
    api.get("/doctor/organizations").then((r) => setOrgs(r.data.organizations)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const select = async (org) => {
    if (org.id === clinic?.id) return;
    try {
      const res = await api.post("/doctor/switch-organization", { clinic_id: org.id });
      switchClinic(res.data.token, res.data.clinic);
      showToast(t("docOrgs.switchedTo").replace("{name}", res.data.clinic.name), "success");
      window.location.href = "/doctor/dashboard";
    } catch (err) {
      showToast(err.response?.data?.error || t("docOrgs.switchFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("nav.switchOrganization")}>
      <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>{t("docOrgs.hint")}</p>
      {loading ? (
        <p>{t("common.loading")}</p>
      ) : (
        <div className="card-grid">
          {orgs.map((org) => (
            <div key={org.id} className={`card ${org.id === clinic?.id ? "card-active" : ""}`}>
              <h3>{org.name}</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{org.clinic_code} · {org.org_type}</p>
              {org.city_name && <p style={{ fontSize: 13 }}>{org.city_name}</p>}
              {org.id === clinic?.id ? (
                <span className="pill" style={{ marginTop: 10, display: "inline-block" }}>{t("docOrgs.currentlyActive")}</span>
              ) : (
                <button className="btn" style={{ marginTop: 10 }} onClick={() => select(org)}>
                  {t("docOrgs.switchToThis")}
                </button>
              )}
            </div>
          ))}
          {orgs.length === 0 && <p>{t("docOrgs.empty")}</p>}
        </div>
      )}
    </DashboardLayout>
  );
}