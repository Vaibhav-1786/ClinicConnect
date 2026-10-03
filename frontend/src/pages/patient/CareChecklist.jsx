import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

export default function CareChecklist() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const CATEGORY_LABEL = {
    lifestyle: t("patCareChecklist.catLifestyle"), follow_up: t("patCareChecklist.catFollowUp"),
    medication: t("patCareChecklist.catMedication"), warning_sign: t("patCareChecklist.catWarning"),
    other: t("patCareChecklist.catOther"),
  };

  const load = () => {
    setLoading(true);
    api.get("/care-checklist/mine").then((r) => setItems(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const toggle = async (item) => {
    try {
      await api.patch(`/care-checklist/${item.id}/toggle`);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_done: !i.is_done } : i)));
    } catch (err) {
      showToast(err.response?.data?.error || t("patCareChecklist.updateFailed"), "error");
    }
  };

  const grouped = items.reduce((acc, item) => {
    const key = `${item.appointment_id}`;
    if (!acc[key]) acc[key] = { doctor_name: item.doctor_name, appointment_date: item.appointment_date, items: [] };
    acc[key].items.push(item);
    return acc;
  }, {});

  return (
    <DashboardLayout title={t("patCareChecklist.title")}>
      <div className="card">
        <h3>{t("patCareChecklist.heading")}</h3>
        <p style={{ color: "var(--text-muted)" }}>{t("patCareChecklist.intro")}</p>

        {loading ? (
          <div className="empty-state">{t("patCareChecklist.loading")}</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="empty-state">{t("patCareChecklist.empty")}</div>
        ) : (
          Object.entries(grouped).map(([apptId, group]) => (
            <div key={apptId} style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
              <h4 style={{ marginBottom: 8 }}>
                {group.appointment_date} — Dr. {group.doctor_name}
              </h4>
              {group.items.map((item) => (
                <label
                  key={item.id}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0",
                    cursor: "pointer", opacity: item.is_done ? 0.6 : 1,
                  }}
                >
                  <input type="checkbox" checked={!!item.is_done} onChange={() => toggle(item)} style={{ marginTop: 3 }} />
                  <span>
                    <span style={{ textDecoration: item.is_done ? "line-through" : "none" }}>{item.item_text}</span>
                    {" "}
                    <span className="pill" style={{ fontSize: 11 }}>{CATEGORY_LABEL[item.category] || item.category}</span>
                  </span>
                </label>
              ))}
            </div>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}
