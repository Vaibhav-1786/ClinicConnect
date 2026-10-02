import React, { useState } from "react";
import api from "../services/api";
import { useToast } from "../context/ToastContext";

export default function SOSButton() {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [contact, setContact] = useState(null);
  const [alerted, setAlerted] = useState(false);
  const { showToast } = useToast();

  const openPanel = async () => {
    setOpen(true);
    setAlerted(false);
    try {
      const r = await api.get("/sos/contact");
      setContact(r.data);
    } catch {
      setContact(null);
    }
  };

  const sendAlert = () => {
    setSending(true);
    const finish = (coords) => {
      api.post("/sos", coords)
        .then((r) => { setAlerted(true); if (r.data.clinic) setContact((c) => ({ ...c, clinic: r.data.clinic })); })
        .catch(() => showToast("Could not reach the server — please call directly instead.", "error"))
        .finally(() => setSending(false));
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => finish({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => finish({}),
        { timeout: 4000 },
      );
    } else {
      finish({});
    }
  };

  const clinicPhone = contact?.clinic?.contact_number;
  const emergencyContact = contact?.patient_emergency_contact;

  return (
    <>
      <button
        onClick={openPanel}
        title="Emergency SOS"
        className="sos-fab"
        style={{
          zIndex: 990,
          width: 56, height: 56, borderRadius: "50%", border: "none", cursor: "pointer",
          background: "var(--danger)", color: "#fff", fontSize: 15, fontWeight: 700,
          boxShadow: "0 4px 14px rgba(220,38,38,0.5)",
        }}
      >
        SOS
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="card modal-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: "var(--danger)" }}>🚨 Emergency Assistance</h3>
            {alerted ? (
              <p>Your clinic has been alerted with your location (if shared). If this is life-threatening, please also call emergency services directly.</p>
            ) : (
              <>
                <p>This will notify your clinic's front desk immediately and share your location, if allowed.</p>
                <button className="btn" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} onClick={sendAlert} disabled={sending}>
                  {sending ? "Sending alert..." : "Send Emergency Alert"}
                </button>
              </>
            )}

            <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              {clinicPhone && (
                <p><strong>Clinic:</strong> {contact.clinic.name} — <a href={`tel:${clinicPhone}`}>{clinicPhone}</a></p>
              )}
              {emergencyContact && (
                <p><strong>Your emergency contact:</strong> <a href={`tel:${emergencyContact}`}>{emergencyContact}</a></p>
              )}
              {!clinicPhone && !emergencyContact && (
                <p style={{ color: "var(--text-muted)" }}>No clinic or emergency contact on file yet.</p>
              )}
            </div>
            <button className="btn secondary small" style={{ marginTop: 12 }} onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}