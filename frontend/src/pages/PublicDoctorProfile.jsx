import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import LanguageSelector from "../components/LanguageSelector";

export default function PublicDoctorProfile() {
  const { token } = useParams();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const { t } = useLanguage();

  useEffect(() => {
    api.get(`/public/doctor-profile/${token}`)
      .then((r) => setProfile(r.data))
      .catch((err) => setError(err.response?.data?.error || t("publicProfile.notFound")));
  }, [token]);

  return (
    <div style={{ maxWidth: 480, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <LanguageSelector />
      </div>
      {error ? (
        <div className="card"><div className="empty-state">{error}</div></div>
      ) : !profile ? (
        <div className="card"><div className="empty-state">{t("common.loading")}</div></div>
      ) : (
        <div className="card" style={{ textAlign: "center" }}>
          {profile.photo_path && (
            <img src={profile.photo_path} alt={profile.full_name}
                 style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover", marginBottom: 12 }} />
          )}
          <h2 style={{ marginBottom: 4 }}>{profile.full_name}</h2>
          <p style={{ color: "var(--text-muted)" }}>{profile.qualification}</p>
          <p style={{ fontWeight: 600 }}>{profile.specialization}</p>
          {profile.is_verified && <p className="pill pill-success">✓ {t("publicProfile.verifiedDoctor")}</p>}
          {profile.bio && <p style={{ marginTop: 12 }}>{profile.bio}</p>}

          {profile.organizations && profile.organizations.length > 0 && (
            <div style={{ textAlign: "left", marginTop: 16 }}>
              <h3>{t("publicProfile.practicesAt")}</h3>
              {profile.organizations.map((o, i) => (
                <div key={i} className="card" style={{ marginBottom: 8 }}>
                  <strong>📍 {o.name}</strong>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>{o.address}</p>
                </div>
              ))}
            </div>
          )}

          {profile.consultation_fee != null && (
            <p style={{ marginTop: 12 }}>{t("publicProfile.consultationFee")}: ₹{profile.consultation_fee}</p>
          )}
        </div>
      )}
    </div>
  );
}
