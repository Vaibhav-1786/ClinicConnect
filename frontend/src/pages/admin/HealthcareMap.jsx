import React, { useEffect, useMemo, useState } from "react";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useLanguage } from "../../context/LanguageContext";

/**
 * Renders clinics/doctors as pins on a simple coordinate-normalized canvas.
 * Deliberately dependency-free (no tile server / API key needed) so it works
 * offline and ships with zero new build risk. Positions markers by
 * normalizing lat/lng into the bounding box of the currently-filtered data.
 */
function useBoundedPositions(points) {
  return useMemo(() => {
    if (points.length === 0) return { positioned: [], bounds: null };
    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const latSpan = maxLat - minLat || 0.01;
    const lngSpan = maxLng - minLng || 0.01;
    const positioned = points.map((p) => ({
      ...p,
      xPct: ((p.longitude - minLng) / lngSpan) * 90 + 5,
      yPct: (1 - (p.latitude - minLat) / latSpan) * 90 + 5,
    }));
    return { positioned, bounds: { minLat, maxLat, minLng, maxLng } };
  }, [points]);
}

export default function AdminHealthcareMap() {
  const { t } = useLanguage();
  const [data, setData] = useState({ clinics: [], doctors: [] });
  const [showClinics, setShowClinics] = useState(true);
  const [showDoctors, setShowDoctors] = useState(true);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [specialization, setSpecialization] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = () => {
    api.get("/admin/map/data", {
      params: { verified_only: verifiedOnly, specialization: specialization || undefined },
    }).then((r) => setData(r.data));
  };
  useEffect(() => { load(); }, [verifiedOnly, specialization]);

  const points = useMemo(() => {
    const pts = [];
    if (showClinics) data.clinics.forEach((c) => pts.push({ kind: "clinic", ...c }));
    if (showDoctors) data.doctors.forEach((d) => pts.push({ kind: "doctor", ...d }));
    return pts;
  }, [data, showClinics, showDoctors]);

  const { positioned } = useBoundedPositions(points);

  const openDetail = async (p) => {
    setSelected(p);
    setDetail(null);
    const url = p.kind === "clinic" ? `/admin/map/organizations/${p.id}` : `/admin/map/doctors/${p.id}`;
    const res = await api.get(url);
    setDetail(res.data);
  };

  return (
    <DashboardLayout title={t("healthcareMap.title")}>
      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <label><input type="checkbox" checked={showClinics} onChange={(e) => setShowClinics(e.target.checked)} /> {t("healthcareMap.showOrganizations")}</label>
        <label><input type="checkbox" checked={showDoctors} onChange={(e) => setShowDoctors(e.target.checked)} /> {t("healthcareMap.showDoctors")}</label>
        <label><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> {t("healthcareMap.verifiedOnly")}</label>
        <input className="input" style={{ margin: 0, width: "min(100%, 200px)" }} placeholder={t("common.specialization")}
               value={specialization} onChange={(e) => setSpecialization(e.target.value)} />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="card" style={{ flex: "2 1 480px", position: "relative", height: "clamp(300px, 60vh, 480px)", overflow: "hidden" }}>
          {positioned.length === 0 ? (
            <div className="empty-state">{t("healthcareMap.noGeoData")}</div>
          ) : (
            <div style={{ position: "relative", width: "100%", height: "100%", background: "var(--bg-subtle)", borderRadius: 8 }}>
              {positioned.map((p) => (
                <button
                  key={`${p.kind}-${p.id}`}
                  onClick={() => openDetail(p)}
                  title={p.name || p.full_name}
                  style={{
                    position: "absolute", left: `${p.xPct}%`, top: `${p.yPct}%`,
                    transform: "translate(-50%, -50%)", border: "none", cursor: "pointer",
                    width: "var(--map-pin, 22px)", height: "var(--map-pin, 22px)", borderRadius: "50%",
                    background: p.kind === "clinic" ? "#2563eb" : "#059669",
                    color: "#fff", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: selected && selected.id === p.id && selected.kind === p.kind ? "0 0 0 3px rgba(0,0,0,.25)" : "0 1px 3px rgba(0,0,0,.3)",
                  }}
                >
                  {p.kind === "clinic" ? "🏥" : "🩺"}
                </button>
              ))}
            </div>
          )}
          <div style={{ position: "absolute", bottom: 8, left: 8, fontSize: 12, background: "var(--card-bg)", color: "var(--text)", padding: "4px 8px", borderRadius: 6 }}>
            🏥 {t("healthcareMap.legendOrg")} &nbsp; 🩺 {t("healthcareMap.legendDoctor")}
          </div>
        </div>

        <div className="card" style={{ flex: "1 1 280px", minHeight: 480 }}>
          <h3>{t("healthcareMap.details")}</h3>
          {!selected ? (
            <div className="empty-state">{t("healthcareMap.selectPin")}</div>
          ) : !detail ? (
            <p>{t("common.loading")}</p>
          ) : selected.kind === "clinic" ? (
            <div>
              <h4>{detail.clinic.name}</h4>
              <p>{t("clinicDetail.doctors")}: {detail.capacity?.doctor_count}</p>
              <p>{t("clinicDetail.departments")}: {detail.capacity?.department_count}</p>
              <p>{t("clinicDetail.todaysAppointments")}: {detail.capacity?.appointments_count}</p>
              <p>{t("clinicDetail.availableSlots")}: {detail.capacity?.available_slots}</p>
              <p>{t("clinicDetail.utilization")}: {detail.capacity?.utilization_pct}%</p>
              {detail.avg_rating != null && <p>{t("healthcareMap.rating")}: {detail.avg_rating}</p>}
            </div>
          ) : (
            <div>
              <h4>{detail.doctor.full_name}</h4>
              <p>{detail.doctor.specialization}</p>
              <p>{t("healthcareMap.organizations")}: {detail.organization_count}</p>
              <p>{t("healthcareMap.appointmentsToday")}: {detail.appointments_today}</p>
              {detail.performance_score != null && <p>{t("doctorDetail.performanceScore")}: {detail.performance_score}</p>}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}