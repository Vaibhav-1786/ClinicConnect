import React, { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function FindClinics() {
  const location = useLocation();
  const { t } = useLanguage();
  const FREQUENCIES = [
    { value: "", label: t("patFindClinics.oneTime") },
    { value: "WEEKLY", label: t("patFindClinics.weekly") },
    { value: "BIWEEKLY", label: t("patFindClinics.biweekly") },
    { value: "MONTHLY", label: t("patFindClinics.monthly") },
  ];
  const [clinics, setClinics] = useState([]);
  const [cityName, setCityName] = useState("");
  const [locationError, setLocationError] = useState("");
  const [familyMembers, setFamilyMembers] = useState([]);
  const [booking, setBooking] = useState(null);
  const [waitlistForm, setWaitlistForm] = useState(null);
  const { showToast } = useToast();
  const dateDebounceRef = useRef(null);

  // Location is no longer a manual search filter: the backend derives it
  // from the authenticated patient's own profile (patients/profile ->
  // city_id) and only ever returns hospitals/clinics in that city.
  const loadHospitals = () => {
    api.get("/patient/hospitals")
      .then((r) => {
        setClinics(r.data.clinics || []);
        setCityName(r.data.city?.name || "");
        setLocationError("");
      })
      .catch((err) => {
        setClinics([]);
        setLocationError(err.response?.data?.error || t("patFindClinics.noClinics"));
      });
  };

  useEffect(() => { loadHospitals(); }, []);
  useEffect(() => { api.get("/patient/family").then((r) => setFamilyMembers(r.data)).catch(() => {}); }, []);
  useEffect(() => () => { if (dateDebounceRef.current) clearTimeout(dateDebounceRef.current); }, []);

  const preselectedMember = location.state?.bookingForFamilyMember;

  useEffect(() => {
    const direct = location.state?.startBookingWith;
    if (direct?.clinic && direct?.doctor) {
      startBooking(direct.clinic, direct.doctor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startBooking = (clinic, doctor) => {
    setBooking({
      clinic, doctor, date: "", slots: [], selectedTime: "", reason: "",
      familyMemberId: preselectedMember ? String(preselectedMember.id) : "",
      consultationMode: "IN_PERSON",
      frequency: "", occurrenceCount: 4, recurringPreview: null,
    });
    setWaitlistForm(null);
  };

  const loadSlots = async (date) => {
    setBooking((b) => ({ ...b, date, selectedTime: "", recurringPreview: null }));
    setWaitlistForm(null);
    if (!date) return;

    // Native <input type="date"> fires onChange on every keystroke while
    // typing the year (e.g. briefly reporting "0026-09-07" as the user
    // types "2026" one digit at a time). Calling the API on those
    // intermediate values makes the backend correctly-but-prematurely
    // reject them as "in the past". Wait for a real 4-digit year before
    // hitting the network, and debounce so we don't fire mid-typing.
    const year = parseInt(date.slice(0, 4), 10);
    if (!Number.isFinite(year) || year < 1900) return;

    if (dateDebounceRef.current) clearTimeout(dateDebounceRef.current);
    dateDebounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get(`/doctors/${booking.doctor.id}/availability?clinic_id=${booking.clinic.id}&date=${date}`);
        setBooking((b) => ({ ...b, date, slots: res.data.slots }));
      } catch (err) {
        // A still-incomplete or otherwise invalid date; leave the date shown
        // as typed and let the user keep editing rather than surfacing an
        // error mid-keystroke.
      }
    }, 400);
  };

  const submitRequest = async () => {
    try {
      await api.post("/appointments/request", {
        doctor_id: booking.doctor.id,
        clinic_id: booking.clinic.id,
        requested_date: booking.date,
        requested_time: `${booking.selectedTime}:00`,
        reason: booking.reason,
        family_member_id: booking.familyMemberId || null,
        consultation_mode: booking.consultationMode,
      });
      showToast(t("patFindClinics.requestSubmitted"), "success");
      setBooking(null);
    } catch (err) {
      showToast(err.response?.data?.error || t("patFindClinics.requestFailed"), "error");
    }
  };

  const previewRecurring = async () => {
    try {
      const res = await api.post("/patient/recurring-appointments/preview", {
        doctor_id: booking.doctor.id,
        clinic_id: booking.clinic.id,
        frequency: booking.frequency,
        preferred_time: booking.selectedTime,
        start_date: booking.date,
        occurrence_count: Number(booking.occurrenceCount),
      });
      setBooking((b) => ({ ...b, recurringPreview: res.data.preview }));
    } catch (err) {
      showToast(err.response?.data?.error || t("patFindClinics.previewFailed"), "error");
    }
  };

  const confirmRecurring = async () => {
    try {
      const res = await api.post("/patient/recurring-appointments", {
        doctor_id: booking.doctor.id,
        clinic_id: booking.clinic.id,
        frequency: booking.frequency,
        preferred_time: booking.selectedTime,
        start_date: booking.date,
        occurrence_count: Number(booking.occurrenceCount),
        reason: booking.reason,
        family_member_id: booking.familyMemberId || null,
      });
      showToast(t("patFindClinics.recurringCreated").replace("{count}", res.data.created_dates.length), "success");
      setBooking(null);
    } catch (err) {
      showToast(err.response?.data?.error || t("patFindClinics.recurringFailed"), "error");
    }
  };

  const joinWaitlist = async () => {
    if (!waitlistForm?.start || !waitlistForm?.end) {
      showToast(t("patFindClinics.selectWindow"), "error");
      return;
    }
    try {
      await api.post("/patient/waitlist", {
        doctor_id: booking.doctor.id,
        clinic_id: booking.clinic.id,
        preferred_date: booking.date,
        preferred_time_start: waitlistForm.start,
        preferred_time_end: waitlistForm.end,
        reason: booking.reason,
        family_member_id: booking.familyMemberId || null,
      });
      showToast(t("patFindClinics.waitlistJoined"), "success");
      setBooking(null);
    } catch (err) {
      showToast(err.response?.data?.error || t("patFindClinics.waitlistFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("nav.findClinic")}>
      {!booking && (
        <>
          <div className="card">
            <p style={{ margin: 0 }}>
              {cityName
                ? <>{t("patFindClinics.showingResultsFor") || "Showing hospitals/clinics in"} <strong>{cityName}</strong>. {t("patFindClinics.changeLocationHint") || "To change your city, update it from your "}<Link to="/patient/profile">{t("nav.profile")}</Link>.</>
                : (locationError || t("common.loading"))}
            </p>
          </div>

          {locationError && clinics.length === 0 ? (
            <div className="empty-state">{locationError}</div>
          ) : clinics.length === 0 ? (
            <div className="empty-state">{t("patFindClinics.noClinics")}</div>
          ) : clinics.map((c) => (
            <div className="card clinic-card" key={c.id}>
              <div className="info">
                <h3>{c.name} <span className="pill">{c.type}</span></h3>
                <p>{c.address}, {c.area_name}, {c.city_name}, {c.state_name}</p>
                <p>📞 {c.contact_number} · 🕒 {String(c.opening_time).slice(0,5)} - {String(c.closing_time).slice(0,5)}</p>
                <div style={{ margin: "8px 0" }}>
                  {c.specializations.map((s) => <span className="pill" key={s}>{s}</span>)}
                </div>
                <div className="table-wrap"><table>
                  <thead><tr><th>{t("dashboard.doctor")}</th><th>{t("patFindSpecialist.fee")}</th><th></th></tr></thead>
                  <tbody>
                    {c.doctors.map((d) => (
                      <tr key={d.id}>
                        <td>Dr. {d.full_name} <span style={{ color: "var(--text-muted)" }}>({d.specialization})</span></td>
                        <td>₹{d.consultation_fee}</td>
                        <td><button className="btn small" onClick={() => startBooking(c, d)}>{t("patFamily.bookAppointment")}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            </div>
          ))}
        </>
      )}

      {booking && (
        <div className="card">
          <div className="step-flow">
            <span className="step done">{booking.clinic.name}</span>
            <span className="step done">Dr. {booking.doctor.full_name}</span>
            <span className={`step ${booking.date ? "done" : "active"}`}>{t("patFindClinics.selectDate")}</span>
            <span className={`step ${booking.selectedTime ? "done" : booking.date ? "active" : ""}`}>{t("patFindClinics.selectSlot")}</span>
            <span className={`step ${booking.selectedTime ? "active" : ""}`}>{t("patFindClinics.reasonSubmit")}</span>
          </div>

          {familyMembers.length > 0 && (
            <>
              <label>{t("patFindClinics.appointmentFor")}</label>
              <select value={booking.familyMemberId} onChange={(e) => setBooking({ ...booking, familyMemberId: e.target.value })}>
                <option value="">{t("patWaitlist.myself")}</option>
                {familyMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name} ({m.relationship})</option>
                ))}
              </select>
            </>
          )}

          <label>{t("patFindClinics.appointmentDate")}</label>
          <input type="date" className="input" min={new Date().toISOString().slice(0,10)}
                 value={booking.date} onChange={(e) => loadSlots(e.target.value)} />

          {booking.date && (
            <>
              <label>{t("patFindClinics.availableSlots")}</label>
              {booking.slots.length === 0 ? (
                <div className="empty-state">
                  {t("patFindClinics.noSlots")}
                  {!waitlistForm ? (
                    <div style={{ marginTop: 10 }}>
                      <button className="btn small" onClick={() => setWaitlistForm({ start: "09:00", end: "17:00" })}>{t("patFindClinics.joinWaitlist")}</button>
                    </div>
                  ) : (
                    <div className="grid grid-3" style={{ marginTop: 10 }}>
                      <div><label>{t("patHealthTimeline.from")}</label><input type="time" className="input" value={waitlistForm.start} onChange={(e) => setWaitlistForm({ ...waitlistForm, start: e.target.value })} /></div>
                      <div><label>{t("patHealthTimeline.to")}</label><input type="time" className="input" value={waitlistForm.end} onChange={(e) => setWaitlistForm({ ...waitlistForm, end: e.target.value })} /></div>
                      <div style={{ display: "flex", alignItems: "flex-end" }}>
                        <button className="btn small" onClick={joinWaitlist}>{t("patFindClinics.confirmWaitlist")}</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="slot-grid">
                  {booking.slots.map((s) => (
                    <div
                      key={s.time}
                      className={`slot ${!s.available ? "unavailable" : booking.selectedTime === s.time ? "selected" : ""}`}
                      onClick={() => s.available && setBooking({ ...booking, selectedTime: s.time, recurringPreview: null })}
                    >
                      {s.time}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {booking.selectedTime && (
            <>
              <label>{t("patFindClinics.reasonForVisit")}</label>
              <textarea rows={3} value={booking.reason} onChange={(e) => setBooking({ ...booking, reason: e.target.value })}
                        placeholder="Briefly describe your symptoms or reason for the visit" />

              {!booking.frequency && (
                <>
                  <label>{t("patFindClinics.consultationType")}</label>
                  <select value={booking.consultationMode} onChange={(e) => setBooking({ ...booking, consultationMode: e.target.value })}>
                    <option value="IN_PERSON">{t("patFindClinics.inPerson")}</option>
                    <option value="ONLINE">{t("patFindClinics.online")}</option>
                  </select>
                  {booking.consultationMode === "ONLINE" && (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{t("patFindClinics.onlineHint")}</p>
                  )}
                </>
              )}

              {booking.consultationMode === "IN_PERSON" && (
                <>
                  <label>{t("patFindClinics.repeatThis")}</label>
                  <select value={booking.frequency} onChange={(e) => setBooking({ ...booking, frequency: e.target.value, recurringPreview: null })}>
                    {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </>
              )}

              {booking.frequency ? (
                <>
                  <label>{t("patFindClinics.numberOfVisits")}</label>
                  <input type="number" className="input" min={2} max={52}
                         value={booking.occurrenceCount}
                         onChange={(e) => setBooking({ ...booking, occurrenceCount: e.target.value, recurringPreview: null })} />
                  <button className="btn small secondary" onClick={previewRecurring}>{t("patFindClinics.previewSchedule")}</button>

                  {booking.recurringPreview && (
                    <div style={{ margin: "12px 0" }}>
                      <div className="table-wrap"><table>
                        <thead><tr><th>{t("common.date")}</th><th>{t("common.time")}</th><th>{t("common.status")}</th></tr></thead>
                        <tbody>
                          {booking.recurringPreview.map((p) => (
                            <tr key={p.date}>
                              <td>{p.date}</td><td>{p.time}</td>
                              <td>{p.available ? <span className="badge CONFIRMED">{t("patFindClinics.available")}</span> : <span className="badge CANCELLED">{p.reason || t("patFindClinics.unavailable")}</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                      <button className="btn" style={{ marginTop: 10 }} onClick={confirmRecurring}>{t("patFindClinics.confirmRecurring")}</button>
                    </div>
                  )}
                </>
              ) : (
                <button className="btn" onClick={submitRequest}>{t("patFindClinics.submitRequest")}</button>
              )}
              <button className="btn secondary" style={{ marginLeft: 8 }} onClick={() => setBooking(null)}>{t("common.cancel")}</button>
            </>
          )}
          {!booking.selectedTime && (
            <button className="btn secondary" onClick={() => setBooking(null)}>{t("patFindClinics.backToSearch")}</button>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
