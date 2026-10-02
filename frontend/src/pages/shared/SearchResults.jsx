import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";

const LABELS = {
  doctors: "Doctors", clinics: "Clinics / Hospitals", appointments: "Appointments",
  prescriptions: "Prescriptions", patients: "Patients", organizations: "Organizations",
  queue: "Today's Queue", receptionists: "Receptionists", applications: "Doctor Applications",
};

function renderItem(category, item) {
  switch (category) {
    case "doctors":
      return `Dr. ${item.full_name} — ${item.specialization || "General"}${item.consultation_fee ? ` · ₹${item.consultation_fee}` : ""}`;
    case "clinics":
      return `${item.name} (${item.org_type}) — ${item.address || ""}`;
    case "appointments":
      return `${item.patient_name ? item.patient_name + " · " : ""}${item.doctor_name ? "Dr. " + item.doctor_name + " · " : ""}${item.appointment_date}${item.appointment_time ? " " + String(item.appointment_time).slice(0,5) : ""} — ${item.status}`;
    case "prescriptions":
      return `${item.prescription_date} — Dr. ${item.doctor_name}${item.diagnosis_text ? ": " + item.diagnosis_text : ""}`;
    case "patients":
      return `${item.full_name} (${item.patient_code})${item.phone ? " · " + item.phone : ""}`;
    case "organizations":
      return `${item.name} (${item.org_type})`;
    case "queue":
      return `Token #${item.token_number} — ${item.patient_name} (${item.status})`;
    case "receptionists":
      return `${item.full_name} (${item.receptionist_code || ""})`;
    case "applications":
      return `${item.full_name} — ${item.clinic_name || ""} (${item.status})`;
    default:
      return JSON.stringify(item);
  }
}

export default function SearchResults() {
  const [params] = useSearchParams();
  const q = params.get("q") || "";
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!q) return;
    setLoading(true);
    setError("");
    api.get(`/search?q=${encodeURIComponent(q)}`)
      .then((r) => setResults(r.data))
      .catch((err) => setError(err.response?.data?.error || "Search failed"))
      .finally(() => setLoading(false));
  }, [q]);

  return (
    <DashboardLayout title={`Search results for "${q}"`}>
      {loading ? (
        <div className="card"><div className="empty-state">Searching...</div></div>
      ) : error ? (
        <div className="card"><div className="empty-state">{error}</div></div>
      ) : !results || Object.values(results).every((v) => v.length === 0) ? (
        <div className="card"><div className="empty-state">No results found.</div></div>
      ) : (
        Object.entries(results).map(([category, items]) => (
          items.length > 0 && (
            <div className="card" key={category}>
              <h3>{LABELS[category] || category} ({items.length})</h3>
              <ul>
                {items.map((item, i) => <li key={i} style={{ padding: "4px 0" }}>{renderItem(category, item)}</li>)}
              </ul>
            </div>
          )
        ))
      )}
    </DashboardLayout>
  );
}
