import React, { useEffect, useState } from "react";
import api from "../services/api";
import { useLanguage } from "../context/LanguageContext";

const STEP_ICON = {
  completed: "✓", current: "●", upcoming: "○", cancelled: "✕", not_applicable: "–",
};

const STEP_LABEL_KEYS = {
  registration: "journey.registration", appointment: "journey.appointment",
  check_in: "journey.checkIn", queue: "journey.queue", vitals: "journey.vitals",
  consultation: "journey.consultation", prescription: "journey.prescription",
  laboratory: "journey.laboratory", billing: "journey.billing", follow_up: "journey.followUp",
};

/**
 * Reusable Patient Journey Timeline (spec section 3).
 * Fetches and renders the Registration → ... → Follow-up flow for one
 * appointment. Used from the patient dashboard, doctor command center,
 * and receptionist/admin patient views alike — same component, the
 * backend already applies role-based access control per viewer.
 *
 * Props:
 *   appointmentId — required unless `useLatestForPatient` is set
 *   useLatestForPatient — if true, ignores appointmentId and fetches the
 *                         signed-in patient's most relevant appointment
 *   compact — smaller variant without the header line
 */
export default function PatientJourneyTimeline({ appointmentId, useLatestForPatient = false, compact = false }) {
  const { t } = useLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = useLatestForPatient
      ? "/patient-journey/patient/latest"
      : `/patient-journey/${appointmentId}`;
    api.get(url)
      .then((r) => setData(r.data))
      .catch(() => setError(t("journey.loadError")))
      .finally(() => setLoading(false));
  }, [appointmentId, useLatestForPatient]);

  if (loading) return <div className="skeleton" style={{ height: 160, borderRadius: 12 }} />;
  if (error) return <div className="empty-state">{error}</div>;
  if (!data || !data.steps || data.steps.length === 0) {
    return <div className="empty-state">{data?.message || t("journey.noJourney")}</div>;
  }

  return (
    <div>
      {!compact && (data.patient_name || data.doctor_name) && (
        <div className="journey-step-meta" style={{ marginBottom: 12 }}>
          {data.patient_name && <strong>{data.patient_name}</strong>}
          {data.doctor_name && <> · {data.doctor_name}</>}
          {data.clinic_name && <> · {data.clinic_name}</>}
        </div>
      )}
      <div className="journey-timeline" role="list" aria-label={t("journey.ariaLabel")}>
        {data.steps.map((step, idx) => (
          <div className={`journey-step ${step.status}`} key={step.key} role="listitem">
            <div className="journey-step-rail" aria-hidden="true">
              <div className="journey-step-dot">{STEP_ICON[step.status] || "○"}</div>
              {idx < data.steps.length - 1 && <div className="journey-step-line" />}
            </div>
            <div className="journey-step-body">
              <div className="journey-step-label">
                {t(STEP_LABEL_KEYS[step.key], step.label)}
                <span className="pill" style={{ marginLeft: 8, fontSize: 10.5 }}>
                  {t(`journey.status.${step.status}`, step.status)}
                </span>
              </div>
              {step.staff && <div className="journey-step-meta">{step.staff}</div>}
              {step.detail && <div className="journey-step-detail">{step.detail}</div>}
              {step.timestamp && <div className="journey-step-meta">{String(step.timestamp).replace("T", " ").slice(0, 16)}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
