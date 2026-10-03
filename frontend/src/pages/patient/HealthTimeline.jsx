import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useLanguage } from "../../context/LanguageContext";

const TYPES = ["", "Appointment", "Consultation", "Prescription", "Vitals", "Lab Report", "Payment", "Vaccination", "Follow-up"];

const TYPE_ICON = {
  Appointment: "📅", Consultation: "🩺", Prescription: "💊", Vitals: "❤️",
  "Lab Report": "🧪", Payment: "💳", Vaccination: "💉", "Follow-up": "🔁",
};

export default function HealthTimeline() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [familyMembers, setFamilyMembers] = useState([]);
  const [filters, setFilters] = useState({ date_from: "", date_to: "", type: "", family_member_id: "" });
  const { t } = useLanguage();

  useEffect(() => { api.get("/patient/family").then((r) => setFamilyMembers(r.data)).catch(() => {}); }, []);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    api.get(`/patient/health-timeline?${params.toString()}`).then((r) => setEvents(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [filters]);

  // Group by date for a clean chronological display
  const grouped = {};
  events.forEach((e) => {
    grouped[e.event_date] = grouped[e.event_date] || [];
    grouped[e.event_date].push(e);
  });

  return (
    <DashboardLayout title={t("nav.healthTimeline")}>
      <div className="card">
        <div className="grid grid-3">
          <div><label>{t("patHealthTimeline.from")}</label><input type="date" className="input" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} /></div>
          <div><label>{t("patHealthTimeline.to")}</label><input type="date" className="input" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} /></div>
          <div>
            <label>{t("patHealthTimeline.recordType")}</label>
            <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
              {TYPES.map((ty) => <option key={ty} value={ty}>{ty || t("patHealthTimeline.allTypes")}</option>)}
            </select>
          </div>
          {familyMembers.length > 0 && (
            <div>
              <label>{t("patFamily.familyMember", "Family Member")}</label>
              <select value={filters.family_member_id} onChange={(e) => setFilters({ ...filters, family_member_id: e.target.value })}>
                <option value="">{t("patHealthTimeline.everyone")}</option>
                {familyMembers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="empty-state">{t("common.loading")}</div></div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="card"><div className="empty-state">{t("patHealthTimeline.empty")}</div></div>
      ) : (
        Object.entries(grouped).map(([date, items]) => (
          <div className="card" key={date}>
            <h3>{new Date(date).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</h3>
            {items.map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                <div style={{ fontSize: 20 }}>{TYPE_ICON[e.event_type] || "•"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <strong>{e.title}</strong>
                    <span className="pill">{e.event_type}</span>
                    {e.family_member_name && <span className="pill">{e.family_member_name}</span>}
                  </div>
                  {e.description && <p style={{ margin: "2px 0", color: "var(--text-muted)" }}>{e.description}</p>}
                  <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
                    {e.doctor_name ? `Dr. ${e.doctor_name}` : ""}{e.doctor_name && e.clinic_name ? " · " : ""}{e.clinic_name || ""}
                    {e.event_time ? ` · ${String(e.event_time).slice(0,5)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </DashboardLayout>
  );
}
