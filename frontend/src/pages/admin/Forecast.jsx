import React, { useState } from "react";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function AdminForecast() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [scopeType, setScopeType] = useState("GLOBAL");
  const [scopeValue, setScopeValue] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/forecast/appointments", {
        params: { scope_type: scopeType, scope_value: scopeValue || undefined },
      });
      if (!res.data.predicted_volume && res.data.error) {
        showToast(res.data.error, "error");
        setResult(null);
      } else {
        setResult(res.data);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout title={t("forecast.title")}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select className="input" style={{ margin: 0, width: "min(100%, 200px)" }} value={scopeType} onChange={(e) => setScopeType(e.target.value)}>
            <option value="GLOBAL">{t("forecast.scopeGlobal")}</option>
            <option value="CITY">{t("forecast.scopeCity")}</option>
            <option value="SPECIALIZATION">{t("forecast.scopeSpecialization")}</option>
            <option value="CLINIC">{t("forecast.scopeClinic")}</option>
          </select>
          {scopeType !== "GLOBAL" && (
            <input className="input" style={{ margin: 0, width: "min(100%, 220px)" }}
                   placeholder={scopeType === "CITY" ? t("forecast.cityIdPlaceholder") : scopeType === "CLINIC" ? t("forecast.clinicIdPlaceholder") : t("common.specialization")}
                   value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} />
          )}
          <button className="btn btn-sm" onClick={run} disabled={loading}>{loading ? t("common.loading") : t("forecast.run")}</button>
        </div>
      </div>

      {result && (
        <div className="card">
          <p style={{ background: "var(--warning-soft)", color: "var(--warning-soft-text)", padding: "6px 10px", borderRadius: 6, display: "inline-block", fontSize: 13 }}>
            {t("forecast.estimateDisclaimer")}
          </p>
          <h2 style={{ marginTop: 12 }}>📈 {t("forecast.appointmentForecast")}</h2>
          <p style={{ fontSize: 20 }}>
            {result.predicted_change_pct >= 0
              ? t("forecast.expectedIncrease").replace("{pct}", result.predicted_change_pct)
              : t("forecast.expectedDecrease").replace("{pct}", Math.abs(result.predicted_change_pct))}
          </p>
          {result.recommendation_text && (
            <div className="card" style={{ background: "var(--info-soft)", color: "var(--info-soft-text)" }}>
              <strong>{t("forecast.recommendation")}:</strong> {result.recommendation_text}
            </div>
          )}
          <div className="table-wrap"><table style={{ marginTop: 12 }}>
            <tbody>
              <tr><td>{t("forecast.historicalAvg")}</td><td>{result.historical_avg_volume}</td></tr>
              <tr><td>{t("forecast.predictedVolume")}</td><td>{result.predicted_volume}</td></tr>
              <tr><td>{t("forecast.confidence")}</td><td>{result.confidence_pct}%</td></tr>
              <tr><td>{t("forecast.period")}</td><td>{result.forecast_period_start} → {result.forecast_period_end}</td></tr>
            </tbody>
          </table></div>
        </div>
      )}
    </DashboardLayout>
  );
}