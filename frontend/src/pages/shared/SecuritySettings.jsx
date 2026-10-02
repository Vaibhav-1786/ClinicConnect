import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";

export default function SecuritySettings() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    api.get("/auth/2fa/status").then((r) => setEnabled(r.data.enabled)).finally(() => setLoading(false));
  }, []);

  const toggle = async () => {
    setSaving(true);
    try {
      const res = await api.post("/auth/2fa/toggle", { enabled: !enabled });
      setEnabled(res.data.enabled);
      showToast(res.data.enabled ? "Two-factor authentication enabled" : "Two-factor authentication disabled", "success");
    } catch (err) {
      showToast(err.response?.data?.error || "Could not update setting", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout title="Account Security">
      <div className="card">
        <h3>Two-Factor Authentication</h3>
        <p style={{ color: "var(--text-muted)" }}>
          When enabled, you'll be asked for a one-time verification code every time you log in, in
          addition to your password. This significantly reduces the risk of unauthorized access even if
          your password is ever compromised.
        </p>
        {loading ? (
          <div className="empty-state">Loading...</div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className={`badge ${enabled ? "CONFIRMED" : "CANCELLED"}`}>{enabled ? "Enabled" : "Disabled"}</span>
            <button className={`btn small ${enabled ? "danger" : ""}`} disabled={saving} onClick={toggle}>
              {saving ? "Updating..." : enabled ? "Disable 2FA" : "Enable 2FA"}
            </button>
          </div>
        )}
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 14 }}>
          Note: this project has no SMS/email gateway configured yet, so verification codes are shown
          directly on screen during login for development and testing.
        </p>
      </div>
    </DashboardLayout>
  );
}
