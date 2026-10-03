import React, { useEffect, useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useLanguage } from "../../context/LanguageContext";

const STATUS_COLORS = {
  COMPLETED: "#16a34a", CANCELLED: "#dc2626", NO_SHOW: "#f59e0b",
  CONFIRMED: "#2563eb", PENDING: "#94a3b8", CHECKED_IN: "#0891b2",
};
const PIE_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#8b5cf6", "#0891b2"];

function pivotByBucket(rows, statusKey = "status") {
  const buckets = {};
  const statuses = new Set();
  rows.forEach((r) => {
    buckets[r.bucket] = buckets[r.bucket] || { bucket: r.bucket };
    buckets[r.bucket][r[statusKey]] = r.total;
    statuses.add(r[statusKey]);
  });
  return { data: Object.values(buckets), statuses: Array.from(statuses) };
}

export default function Analytics() {
  const [granularity, setGranularity] = useState("daily");
  const [appts, setAppts] = useState({ data: [], statuses: [] });
  const [growth, setGrowth] = useState([]);
  const [revenue, setRevenue] = useState({ by_period: [], by_organization: [] });
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/admin/analytics/appointments?granularity=${granularity}`),
      api.get("/admin/analytics/patient-growth"),
      api.get(`/admin/analytics/revenue?granularity=${granularity}`),
      api.get("/admin/analytics/organizations"),
    ]).then(([a, g, r, o]) => {
      setAppts(pivotByBucket(a.data));
      setGrowth(g.data);
      setRevenue(r.data);
      setOrgs(o.data);
    }).finally(() => setLoading(false));
  }, [granularity]);

  return (
    <DashboardLayout title={t("adminAnalytics.title")}>
      <div className="card">
        <label>{t("adminAnalytics.granularity")}</label>
        <select value={granularity} onChange={(e) => setGranularity(e.target.value)} style={{ width: "min(100%, 160px)" }}>
          <option value="daily">{t("adminAnalytics.daily")}</option>
          <option value="weekly">{t("adminAnalytics.weekly")}</option>
          <option value="monthly">{t("adminAnalytics.monthly")}</option>
        </select>
      </div>

      {loading ? (
        <div className="card"><div className="empty-state">{t("adminAnalytics.loadingAnalytics")}</div></div>
      ) : (
        <>
          <div className="card">
            <h3>{t("adminAnalytics.appointmentAnalytics")}</h3>
            {appts.data.length === 0 ? <div className="empty-state">{t("adminAnalytics.noApptData")}</div> : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={appts.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  {appts.statuses.map((s) => (
                    <Bar key={s} dataKey={s} stackId="a" fill={STATUS_COLORS[s] || "#64748b"} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card">
            <h3>{t("adminAnalytics.patientGrowth")}</h3>
            {growth.length === 0 ? <div className="empty-state">{t("adminAnalytics.noPatientData")}</div> : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={growth}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="new_patients" stroke="#2563eb" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card">
            <h3>{t("adminAnalytics.revenueAnalytics")}</h3>
            {revenue.by_period.length === 0 ? <div className="empty-state">{t("adminAnalytics.noRevenue")}</div> : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={revenue.by_period}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" />
                  <YAxis />
                  <Tooltip formatter={(v) => `₹${v}`} />
                  <Line type="monotone" dataKey="total" stroke="#16a34a" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
            {revenue.by_organization.length > 0 && (
              <div className="table-wrap"><table style={{ marginTop: 16 }}>
                <thead><tr><th>{t("adminAnalytics.organization")}</th><th>{t("docQueue.type")}</th><th>{t("adminAnalytics.revenue")}</th></tr></thead>
                <tbody>
                  {revenue.by_organization.map((o, i) => (
                    <tr key={i}><td>{o.clinic_name}</td><td>{o.org_type}</td><td>₹{o.total}</td></tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>

          <div className="card">
            <h3>{t("adminAnalytics.orgStatistics")}</h3>
            {orgs.length === 0 ? <div className="empty-state">{t("adminAnalytics.noOrgs")}</div> : (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={orgs}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="total_appointments" fill="#2563eb" name={t("adminAnalytics.appointments")} />
                    <Bar dataKey="patient_volume" fill="#16a34a" name={t("adminAnalytics.patients")} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="table-wrap"><table style={{ marginTop: 16 }}>
                  <thead><tr><th>{t("adminAnalytics.organization")}</th><th>{t("docQueue.type")}</th><th>{t("adminAnalytics.appointments")}</th><th>{t("adminAnalytics.patients")}</th><th>{t("dashboard.completed")}</th><th>{t("recAppointments.cancelledOpt")}</th><th>{t("adminAnalytics.noShows")}</th></tr></thead>
                  <tbody>
                    {orgs.map((o) => (
                      <tr key={o.id}>
                        <td>{o.name}</td><td>{o.org_type}</td><td>{o.total_appointments}</td>
                        <td>{o.patient_volume}</td><td>{o.completed}</td><td>{o.cancelled}</td><td>{o.no_shows}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </>
            )}
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
