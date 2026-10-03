import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const empty = {
  full_name: "", first_name: "", middle_name: "", last_name: "", dob: "", gender: "Male",
  mobile: "", email: "", address: "", state_id: "", city_id: "", area_id: "",
  specialization: "", qualification: "", university: "", registration_number: "",
  registration_authority: "", registration_year: "", experience_years: "", consultation_fee: "",
  appointment_duration_minutes: "15", bio: "", languages_known: "",

  mode: "new", // "new" clinic vs "existing" clinic
  existing_clinic_id: "", clinic_name: "", org_type: "clinic",
  clinic_state_id: "", clinic_city_id: "", clinic_area_id: "",
  clinic_address: "", clinic_pincode: "", map_location: "",
  clinic_phone: "", clinic_email: "", clinic_emergency_contact: "", clinic_website: "",
  opening_time: "09:00", closing_time: "18:00", working_days: "Mon-Sat", emergency_service: false,
  consultation_rooms: "", beds: "", facilities: "", about: "",
};

// Fields that only apply to the "Register new organization" flow and must
// never be submitted when the admin is adding the doctor to an existing
// organization.
const PROFESSIONAL_FIELDS = [
  "specialization", "qualification", "university", "registration_number",
  "registration_authority", "registration_year", "experience_years", "consultation_fee",
  "appointment_duration_minutes", "bio", "languages_known",
];

export default function AdminApplicationNew() {
  const [form, setForm] = useState(empty);
  const [files, setFiles] = useState({});
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const [areas, setAreas] = useState([]);
  const [clinicCities, setClinicCities] = useState([]);
  const [clinicAreas, setClinicAreas] = useState([]);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { t } = useLanguage();

  // "Add to existing organization" dropdown: sourced from the doctor's own
  // location (Area first, falling back to City) in the Doctor Information
  // section above — never from a raw list of every clinic on the platform,
  // and never restricted to organizations the doctor already happens to be
  // linked to.
  // status: idle (no location yet) | loading | done | error
  const [existingOrgs, setExistingOrgs] = useState({ status: "idle", filteredBy: null, organizations: [] });

  const DOC_FIELDS = [
    ["degree_certificate", t("adminAppNew.degreeCertificate")],
    ["medical_registration_certificate", t("adminAppNew.medicalRegCertificate")],
    ["identity_proof", t("adminAppNew.identityProof")],
    ["additional_certificate", t("adminAppNew.additionalCertificate")],
    ["profile_photo", t("adminAppNew.profilePhoto")],
  ];

  useEffect(() => { api.get("/locations/states").then((r) => setStates(r.data)); }, []);
  useEffect(() => {
    if (form.state_id) api.get(`/locations/cities?state_id=${form.state_id}`).then((r) => setCities(r.data));
    else setCities([]);
  }, [form.state_id]);
  useEffect(() => {
    if (form.city_id) api.get(`/locations/areas?city_id=${form.city_id}`).then((r) => setAreas(r.data));
    else setAreas([]);
  }, [form.city_id]);

  // Clinic/Hospital location cascade for "Register new organization" — the
  // database requires city_id and area_id (NOT NULL), so these can't be
  // left as free text or skipped the way the old form did.
  useEffect(() => {
    if (form.clinic_state_id) {
      api.get(`/locations/cities?state_id=${form.clinic_state_id}`).then((r) => setClinicCities(r.data));
    } else {
      setClinicCities([]);
    }
  }, [form.clinic_state_id]);
  useEffect(() => {
    if (form.clinic_city_id) {
      api.get(`/locations/areas?city_id=${form.clinic_city_id}`).then((r) => setClinicAreas(r.data));
    } else {
      setClinicAreas([]);
    }
  }, [form.clinic_city_id]);

  const runExistingOrgLookup = () => {
    if (form.mode !== "existing") return;
    const areaId = form.area_id;
    const cityId = form.city_id;
    if (!areaId && !cityId) {
      setExistingOrgs({ status: "idle", filteredBy: null, organizations: [] });
      return;
    }
    setExistingOrgs((s) => ({ ...s, status: "loading" }));
    const params = new URLSearchParams();
    if (areaId) params.set("area_id", areaId);
    else params.set("city_id", cityId);
    api.get(`/admin/clinics/available?${params.toString()}`)
      .then((r) => {
        const organizations = r.data.organizations || [];
        setExistingOrgs({ status: "done", filteredBy: r.data.filtered_by, organizations });
        // Don't leave an organization selected if it no longer matches the
        // doctor's current location.
        setForm((f) => (
          organizations.some((o) => String(o.id) === String(f.existing_clinic_id))
            ? f
            : { ...f, existing_clinic_id: "" }
        ));
      })
      .catch(() => {
        setExistingOrgs({ status: "error", filteredBy: null, organizations: [] });
      });
  };

  // Re-run the lookup whenever "Add to existing organization" is active and
  // the doctor's Area or City changes — Area takes priority, City is the
  // fallback when no Area is selected.
  useEffect(() => {
    runExistingOrgLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.mode, form.area_id, form.city_id]);

  const set = (field) => (e) => {
    const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: val }));
  };
  const setFile = (field) => (e) => setFiles((f) => ({ ...f, [field]: e.target.files[0] }));

  const selectedOrg = existingOrgs.organizations.find((o) => String(o.id) === String(form.existing_clinic_id));

  const orgTypeLabel = (orgType) => {
    const key = orgType === "multi_speciality_hospital" ? "multiSpecialityHospital"
      : orgType === "diagnostic_center" ? "diagnosticCenter"
      : orgType === "other" ? null
      : orgType;
    return key ? t(`adminAppNew.${key}`) : orgType;
  };

  const orgLabel = (o) => {
    const locationLabel = [o.area_name, o.city_name].filter(Boolean).join(", ");
    return `${o.name} — ${orgTypeLabel(o.org_type)}${locationLabel ? ` — ${locationLabel}` : ""}`;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (form.mode === "existing" && !form.existing_clinic_id) {
      showToast(t("adminAppNew.selectOrg"), "error");
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (k === "mode") return;
        if (form.mode === "existing" && k.startsWith("clinic_") && k !== "existing_clinic_id") return;
        if (form.mode === "existing" && PROFESSIONAL_FIELDS.includes(k)) return;
        if (form.mode === "new" && k === "existing_clinic_id") return;
        if (v !== "" && v !== null && v !== undefined) fd.append(k, v);
      });
      // Verification documents only apply to "Register new organization".
      if (form.mode === "new") {
        Object.entries(files).forEach(([k, file]) => file && fd.append(k, file));
      }

      const res = await api.post("/admin/applications", fd, { headers: { "Content-Type": "multipart/form-data" } });
      showToast(t("adminAppNew.submitted"), "success");
      navigate(`/admin/applications/${res.data.application_id}`);
    } catch (err) {
      showToast(err.response?.data?.error || t("adminAppNew.submitFailed"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout title={t("adminAppNew.title")}>
      <form onSubmit={submit} className="card">
        {/* Step 1 — Doctor Information */}
        <h3>{t("adminAppNew.doctorInfo")}</h3>
        <div className="form-grid">
          <div><label>{t("patProfile.fullName")}</label><input className="input" value={form.full_name} onChange={set("full_name")} required /></div>
          <div><label>{t("adminAppNew.firstName")}</label><input className="input" value={form.first_name} onChange={set("first_name")} /></div>
          <div><label>{t("adminAppNew.middleName")}</label><input className="input" value={form.middle_name} onChange={set("middle_name")} /></div>
          <div><label>{t("adminAppNew.lastName")}</label><input className="input" value={form.last_name} onChange={set("last_name")} /></div>
          <div><label>{t("patFamily.dobFull")}</label><input className="input" type="date" value={form.dob} onChange={set("dob")} /></div>
          <div><label>{t("patFamily.gender")}</label>
            <select className="input" value={form.gender} onChange={set("gender")}>
              <option>Male</option><option>Female</option><option>Other</option>
            </select>
          </div>
          <div><label>{t("adminAppNew.mobile")}</label><input className="input" value={form.mobile} onChange={set("mobile")} required /></div>
          <div><label>{t("common.email")}</label><input className="input" type="email" value={form.email} onChange={set("email")} required /></div>
          <div><label>{t("adminAppNew.state")}</label>
            <select
              className="input" value={form.state_id}
              onChange={(e) => setForm((f) => ({ ...f, state_id: e.target.value, city_id: "", area_id: "" }))}
            >
              <option value="">{t("patFamily.select")}</option>
              {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div><label>{t("adminAppNew.city")}</label>
            <select
              className="input" value={form.city_id}
              onChange={(e) => setForm((f) => ({ ...f, city_id: e.target.value, area_id: "" }))}
              disabled={!form.state_id}
            >
              <option value="">{t("patFamily.select")}</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><label>{t("adminAppNew.area")}</label>
            <select
              className="input" value={form.area_id} onChange={set("area_id")}
              disabled={!form.city_id}
            >
              <option value="">{t("patFamily.select")}</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}><label>{t("patFamily.address")}</label><input className="input" value={form.address} onChange={set("address")} /></div>
        </div>

        {/* Step 2 — Organization Selection */}
        <h3>{t("adminAppNew.organization")}</h3>
        <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
          <label><input type="radio" checked={form.mode === "new"} onChange={() => setForm((f) => ({ ...f, mode: "new", existing_clinic_id: "" }))} /> {t("adminAppNew.registerNewOrg")}</label>
          <label><input type="radio" checked={form.mode === "existing"} onChange={() => setForm((f) => ({ ...f, mode: "existing" }))} /> {t("adminAppNew.addToExisting")}</label>
        </div>

        {form.mode === "new" && (
          <>
            {/* Step 3 — Professional Information (Register new organization only) */}
            <h3>{t("adminAppNew.professionalInfo")}</h3>
            <div className="form-grid">
              <div><label>{t("common.specialization")}</label><input className="input" value={form.specialization} onChange={set("specialization")} required /></div>
              <div><label>{t("adminAppNew.qualification")}</label><input className="input" value={form.qualification} onChange={set("qualification")} required /></div>
              <div><label>{t("adminAppNew.university")}</label><input className="input" value={form.university} onChange={set("university")} /></div>
              <div><label>{t("adminAppNew.regNumber")}</label><input className="input" value={form.registration_number} onChange={set("registration_number")} /></div>
              <div><label>{t("adminAppNew.regAuthority")}</label><input className="input" value={form.registration_authority} onChange={set("registration_authority")} /></div>
              <div><label>{t("adminAppNew.regYear")}</label><input className="input" type="number" value={form.registration_year} onChange={set("registration_year")} /></div>
              <div><label>{t("adminAppNew.yearsExperience")}</label><input className="input" type="number" value={form.experience_years} onChange={set("experience_years")} /></div>
              <div><label>{t("adminAppDetail.consultationFee")}</label><input className="input" type="number" value={form.consultation_fee} onChange={set("consultation_fee")} /></div>
              <div><label>{t("adminAppNew.apptDuration")}</label><input className="input" type="number" value={form.appointment_duration_minutes} onChange={set("appointment_duration_minutes")} /></div>
              <div><label>{t("adminAppNew.languagesKnown")}</label><input className="input" value={form.languages_known} onChange={set("languages_known")} /></div>
            </div>
            <label>{t("adminAppNew.doctorBio")}</label>
            <textarea className="input" value={form.bio} onChange={set("bio")} />

            {/* Step 4 — Verification Documents (Register new organization only) */}
            <h3>{t("adminAppNew.verificationDocs")}</h3>
            <div className="form-grid">
              {DOC_FIELDS.map(([key, label]) => (
                <div key={key}>
                  <label>{label}</label>
                  <input className="input" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={setFile(key)} />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Step 5 — Clinic / Hospital Details */}
        <h3>{t("adminAppDetail.clinicDetails")}</h3>

        {form.mode === "existing" ? (
          <div>
            {existingOrgs.status === "idle" && (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("adminAppNew.selectLocationFirst")}</p>
            )}

            {existingOrgs.status === "loading" && (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("adminAppNew.loadingOrgs")}</p>
            )}

            {existingOrgs.status === "error" && (
              <div>
                <p style={{ fontSize: 13, color: "var(--danger)" }}>{t("adminAppNew.orgLoadFailed")}</p>
                <button type="button" className="btn btn-outline btn-sm" onClick={runExistingOrgLookup}>{t("adminAppNew.retry")}</button>
              </div>
            )}

            {existingOrgs.status === "done" && existingOrgs.organizations.length === 0 && (
              <div>
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("adminAppNew.noExistingOrg")}</p>
                <button
                  type="button" className="btn btn-outline btn-sm"
                  onClick={() => setForm((f) => ({ ...f, mode: "new", existing_clinic_id: "" }))}
                >
                  {t("adminAppNew.registerNewOrg")}
                </button>
              </div>
            )}

            {existingOrgs.status === "done" && existingOrgs.organizations.length > 0 && (
              <>
                <label>{t("adminAppNew.existingClinic")}</label>
                <select className="input" value={form.existing_clinic_id} onChange={set("existing_clinic_id")} required>
                  <option value="">{t("adminAppNew.selectOrg")}</option>
                  {existingOrgs.organizations.map((o) => (
                    <option key={o.id} value={o.id}>{orgLabel(o)}</option>
                  ))}
                </select>

                {selectedOrg && (
                  <>
                    <h4 style={{ marginTop: 16 }}>{t("adminAppNew.existingOrgDetails")}</h4>
                    <div className="form-grid">
                      <div><label>{t("adminAppNew.clinicName")}</label><input className="input" value={selectedOrg.name || ""} disabled readOnly /></div>
                      <div><label>{t("adminAppNew.orgType")}</label><input className="input" value={orgTypeLabel(selectedOrg.org_type) || ""} disabled readOnly /></div>
                      <div><label>{t("adminAppNew.state")}</label><input className="input" value={selectedOrg.state_name || ""} disabled readOnly /></div>
                      <div><label>{t("adminAppNew.city")}</label><input className="input" value={selectedOrg.city_name || ""} disabled readOnly /></div>
                      <div><label>{t("adminAppNew.area")}</label><input className="input" value={selectedOrg.area_name || ""} disabled readOnly /></div>
                      <div><label>{t("patFamily.address")}</label><input className="input" value={selectedOrg.address || ""} disabled readOnly /></div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            <div className="form-grid">
              <div><label>{t("adminAppNew.clinicName")}</label><input className="input" value={form.clinic_name} onChange={set("clinic_name")} required /></div>
              <div><label>{t("adminAppNew.orgType")}</label>
                <select className="input" value={form.org_type} onChange={set("org_type")}>
                  <option value="clinic">{t("adminAppNew.clinic")}</option>
                  <option value="hospital">{t("adminAppNew.hospital")}</option>
                  <option value="diagnostic_center">{t("adminAppNew.diagnosticCenter")}</option>
                  <option value="multi_speciality_hospital">{t("adminAppNew.multiSpecialityHospital")}</option>
                  <option value="other">{t("patFamily.other")}</option>
                </select>
              </div>
              <div><label>{t("adminAppNew.state")}</label>
                <select
                  className="input" value={form.clinic_state_id}
                  onChange={(e) => setForm((f) => ({ ...f, clinic_state_id: e.target.value, clinic_city_id: "", clinic_area_id: "" }))}
                  required
                >
                  <option value="">{t("patFamily.select")}</option>
                  {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div><label>{t("adminAppNew.city")}</label>
                <select
                  className="input" value={form.clinic_city_id}
                  onChange={(e) => setForm((f) => ({ ...f, clinic_city_id: e.target.value, clinic_area_id: "" }))}
                  required disabled={!form.clinic_state_id}
                >
                  <option value="">{t("patFamily.select")}</option>
                  {clinicCities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label>{t("adminAppNew.area")}</label>
                <select
                  className="input" value={form.clinic_area_id} onChange={set("clinic_area_id")}
                  required disabled={!form.clinic_city_id}
                >
                  <option value="">{t("patFamily.select")}</option>
                  {clinicAreas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div><label>{t("patFamily.address")}</label><input className="input" value={form.clinic_address} onChange={set("clinic_address")} /></div>
              <div><label>{t("adminAppNew.pincode")}</label><input className="input" value={form.clinic_pincode} onChange={set("clinic_pincode")} /></div>
              <div><label>{t("adminAppNew.mapsLocation")}</label><input className="input" value={form.map_location} onChange={set("map_location")} /></div>
              <div><label>{t("common.phone")}</label><input className="input" value={form.clinic_phone} onChange={set("clinic_phone")} /></div>
              <div><label>{t("common.email")}</label><input className="input" value={form.clinic_email} onChange={set("clinic_email")} /></div>
              <div><label>{t("patFamily.emergencyContact")}</label><input className="input" value={form.clinic_emergency_contact} onChange={set("clinic_emergency_contact")} /></div>
              <div><label>{t("adminAppNew.website")}</label><input className="input" value={form.clinic_website} onChange={set("clinic_website")} /></div>
              <div><label>{t("adminAppNew.openingTime")}</label><input className="input" type="time" value={form.opening_time} onChange={set("opening_time")} /></div>
              <div><label>{t("adminAppNew.closingTime")}</label><input className="input" type="time" value={form.closing_time} onChange={set("closing_time")} /></div>
              <div><label>{t("adminAppNew.workingDays")}</label><input className="input" value={form.working_days} onChange={set("working_days")} /></div>
              <div><label>{t("adminAppNew.consultationRooms")}</label><input className="input" type="number" value={form.consultation_rooms} onChange={set("consultation_rooms")} /></div>
              <div><label>{t("adminAppNew.beds")}</label><input className="input" type="number" value={form.beds} onChange={set("beds")} /></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20 }}>
                <input type="checkbox" checked={form.emergency_service} onChange={set("emergency_service")} /> <label style={{ margin: 0 }}>{t("adminAppNew.emergencyServiceAvailable")}</label>
              </div>
            </div>
            <label>{t("adminAppNew.facilities")}</label>
            <textarea className="input" value={form.facilities} onChange={set("facilities")} />
            <label>{t("adminAppNew.about")}</label>
            <textarea className="input" value={form.about} onChange={set("about")} />
          </>
        )}

        <button className="btn" type="submit" disabled={loading} style={{ marginTop: 16 }}>
          {loading ? t("adminAppNew.submitting") : t("adminAppNew.submitApplication")}
        </button>
      </form>
    </DashboardLayout>
  );
}