import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function PatientProfile() {
  const [profile, setProfile] = useState(null);
  const [cities, setCities] = useState([]);
  const { showToast } = useToast();
  const { t } = useLanguage();

  useEffect(() => {
    api.get("/patients/profile").then((r) => setProfile({ ...r.data, _original_city_id: r.data.city_id }));
  }, []);
  useEffect(() => { api.get("/locations/cities/all").then((r) => setCities(r.data)).catch(() => {}); }, []);

  const save = async () => {
    try {
      const cityChanged = profile.city_id !== profile._original_city_id;
      await api.put("/patients/profile", {
        full_name: profile.full_name, address: profile.address,
        blood_group: profile.blood_group, allergies: profile.allergies,
        emergency_contact: profile.emergency_contact,
        city_id: profile.city_id || null,
      });
      if (cityChanged) {
        // Location changed from the profile: only this patient's row was
        // touched (server-enforced). Refresh so the hospital/clinic list
        // the patient sees elsewhere in the app reflects the new city.
        showToast(t("patProfile.updated") + " — hospital/clinic list will refresh for your new city.", "success");
      } else {
        showToast(t("patProfile.updated"), "success");
      }
    } catch (err) {
      showToast(err.response?.data?.error || t("patProfile.updateFailed"), "error");
    }
  };

  if (!profile) return <DashboardLayout title={t("nav.profile")}><div className="card">{t("common.loading")}</div></DashboardLayout>;

  return (
    <DashboardLayout title={t("nav.profile")}>
      <div className="card" style={{ maxWidth: 480 }}>
        <label>{t("patProfile.patientId")}</label>
        <input className="input" value={profile.patient_code} disabled />
        <label>{t("patProfile.fullName")}</label>
        <input className="input" value={profile.full_name || ""} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} />
        <label>{t("common.email")}</label>
        <input className="input" value={profile.email || ""} disabled />
        <label>{t("patFamily.address")}</label>
        <input className="input" value={profile.address || ""} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
        <label>City / Location</label>
        <select className="input" value={profile.city_id || ""} onChange={(e) => setProfile({ ...profile, city_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Select City</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.state_name ? `, ${c.state_name}` : ""}</option>
          ))}
        </select>
        <label>{t("patFamily.bloodGroup")}</label>
        <input className="input" value={profile.blood_group || ""} onChange={(e) => setProfile({ ...profile, blood_group: e.target.value })} />
        <label>{t("patFamily.allergies")}</label>
        <input className="input" value={profile.allergies || ""} onChange={(e) => setProfile({ ...profile, allergies: e.target.value })} />
        <label>{t("patFamily.emergencyContact")}</label>
        <input className="input" value={profile.emergency_contact || ""} onChange={(e) => setProfile({ ...profile, emergency_contact: e.target.value })} />
        <button className="btn" onClick={save}>{t("patFamily.saveChanges")}</button>
      </div>
    </DashboardLayout>
  );
}
