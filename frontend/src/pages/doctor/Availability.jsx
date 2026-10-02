import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function DoctorAvailability() {
  const { clinic } = useAuth();
  const [data, setData] = useState({ availability: [], leaves: [] });
  const [form, setForm] = useState({ day_of_week: 0, start_time: "09:00", end_time: "13:00" });
  const [leaveDate, setLeaveDate] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const { showToast } = useToast();
  const { t } = useLanguage();
  const DAYS = [t("docAvailability.monday"), t("docAvailability.tuesday"), t("docAvailability.wednesday"), t("docAvailability.thursday"), t("docAvailability.friday"), t("docAvailability.saturday"), t("docAvailability.sunday")];

  // Availability is stored per Doctor + Clinic/Hospital. This page only ever
  // shows/edits the schedule for the organization currently selected — use
  // "Switch Clinic/Hospital" to manage another organization's hours.
  const load = () => api.get("/doctor/availability").then((r) => setData(r.data));
  useEffect(() => { load(); }, []);

  const addSlot = async () => {
    try {
      await api.post("/doctor/availability", form);
      showToast(t("docAvailability.added"), "success");
      load();
    } catch (err) { showToast(err.response?.data?.error || t("docAvailability.addFailed"), "error"); }
  };

  const removeSlot = async (id) => {
    await api.delete(`/doctor/availability/${id}`);
    load();
  };

  const addLeave = async () => {
    if (!leaveDate) return;
    try {
      await api.post("/doctor/leaves", { leave_date: leaveDate, reason: leaveReason });
      showToast(t("docAvailability.leaveAdded"), "success");
      setLeaveDate(""); setLeaveReason("");
      load();
    } catch (err) { showToast(err.response?.data?.error || t("docAvailability.leaveAddFailed"), "error"); }
  };

  const removeLeave = async (id) => {
    await api.delete(`/doctor/leaves/${id}`);
    load();
  };

  return (
    <DashboardLayout title={t("nav.availability")}>
      <div className="card">
        <h3>{t("docAvailability.weeklyHours")} — {clinic?.name} ({clinic?.clinic_code})</h3>
        <div className="inline-fields">
          <select className="input" style={{ margin: 0 }} value={form.day_of_week} onChange={(e) => setForm({ ...form, day_of_week: Number(e.target.value) })}>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
          <input className="input" style={{ margin: 0 }} type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          <input className="input" style={{ margin: 0 }} type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          <button className="btn" onClick={addSlot}>{t("docAvailability.add")}</button>
        </div>

        <div className="table-wrap"><table style={{ marginTop: 12 }}>
          <thead><tr><th>{t("docAvailability.day")}</th><th>{t("docAvailability.start")}</th><th>{t("docAvailability.end")}</th><th></th></tr></thead>
          <tbody>
            {data.availability.map((a) => (
              <tr key={a.id}>
                <td>{DAYS[a.day_of_week]}</td>
                <td>{String(a.start_time).slice(0, 5)}</td><td>{String(a.end_time).slice(0, 5)}</td>
                <td><button className="btn btn-danger btn-sm" onClick={() => removeSlot(a.id)}>{t("docAvailability.remove")}</button></td>
              </tr>
            ))}
            {data.availability.length === 0 && <tr><td colSpan={4}>{t("docAvailability.noAvailability")}</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>{t("docAvailability.leaveHolidayDates")}</h3>
        <div className="inline-fields">
          <input className="input" style={{ margin: 0 }} type="date" value={leaveDate} onChange={(e) => setLeaveDate(e.target.value)} />
          <input className="input" style={{ margin: 0 }} placeholder={t("docAvailability.reasonOptional")} value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} />
          <button className="btn" onClick={addLeave}>{t("docAvailability.addLeave")}</button>
        </div>
        <div className="table-wrap"><table style={{ marginTop: 12 }}>
          <thead><tr><th>{t("common.date")}</th><th>{t("docAvailability.reason")}</th><th></th></tr></thead>
          <tbody>
            {data.leaves.map((l) => (
              <tr key={l.id}><td>{l.leave_date}</td><td>{l.reason}</td>
                <td><button className="btn btn-danger btn-sm" onClick={() => removeLeave(l.id)}>{t("docAvailability.remove")}</button></td>
              </tr>
            ))}
            {data.leaves.length === 0 && <tr><td colSpan={3}>{t("docAvailability.noLeaves")}</td></tr>}
          </tbody>
        </table></div>
      </div>
    </DashboardLayout>
  );
}
