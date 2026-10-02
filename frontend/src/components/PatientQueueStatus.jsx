import React, { useEffect, useState } from "react";
import api from "../services/api";
import { useLanguage } from "../context/LanguageContext";

/**
 * Live Queue — patient view (spec section 10):
 *   "You are #2 in queue — Estimated waiting time: ~18 min"
 * Polls periodically so the position updates without a manual refresh.
 */
export default function PatientQueueStatus() {
  const { t } = useLanguage();
  const [entry, setEntry] = useState(null);
  const [checked, setChecked] = useState(false);

  const load = () => {
    api.get("/patient/queue/status").then((r) => {
      const active = (r.data || []).find((q) => ["Waiting", "Called", "Skipped"].includes(q.status));
      setEntry(active || null);
    }).finally(() => setChecked(true));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!checked) return null;
  if (!entry) return null; // nothing to show when the patient isn't in a queue today

  return (
    <div className="card" style={{ textAlign: "center" }}>
      <h3>{t("patQueue.title")}</h3>
      <div style={{ fontSize: 32, fontWeight: 700 }}>
        {entry.status === "Called"
          ? t("patQueue.beingCalled")
          : t("patQueue.position", "You are #{n} in queue").replace("{n}", entry.queue_position ?? "?")}
      </div>
      {entry.status !== "Called" && entry.estimated_wait_minutes != null && (
        <p style={{ color: "var(--text-muted)" }}>
          {t("patQueue.estimatedWait", "Estimated waiting time: ~{min} min").replace("{min}", entry.estimated_wait_minutes)}
        </p>
      )}
      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
        {t("docQueue.token")} #{entry.token_number} · Dr. {entry.doctor_name} · {entry.clinic_name}
      </p>
    </div>
  );
}
