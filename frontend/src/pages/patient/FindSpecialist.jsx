import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useLanguage } from "../../context/LanguageContext";

const CATEGORY_ICON = {
  dental: "🦷", skin: "🧴", eye: "👁️", bone_joint: "🦴", heart: "❤️",
  child_care: "🧸", womens_health: "🌸", general: "🩺", physiotherapy: "🤸", mental_wellness: "🧠",
};

export default function FindSpecialist() {
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => { api.get("/specialist-routing/categories").then((r) => setCategories(r.data)); }, []);

  const search = async (key) => {
    setSelected(key);
    setLoading(true);
    try {
      const res = await api.get(`/specialist-routing/search?category=${key}`);
      setResult(res.data);
    } finally {
      setLoading(false);
    }
  };

  const bookWith = (row) => {
    navigate("/patient/clinics", {
      state: {
        startBookingWith: {
          clinic: { id: row.clinic_id, name: row.clinic_name },
          doctor: { id: row.id, full_name: row.full_name, specialization: row.specialization },
        },
      },
    });
  };

  return (
    <DashboardLayout title={t("nav.findSpecialist")}>
      <div className="card">
        <p style={{ color: "var(--text-muted)" }}>{t("patFindSpecialist.hint")}</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {categories.map((c) => (
            <button
              key={c.key}
              className={`btn small ${selected === c.key ? "" : "secondary"}`}
              onClick={() => search(c.key)}
            >
              {CATEGORY_ICON[c.key] || "•"} {c.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="card"><div className="empty-state">{t("patFindSpecialist.searching")}</div></div>}

      {result && !loading && (
        <div className="card">
          <h3>{result.category}</h3>
          <p style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>{result.disclaimer}</p>
          {result.results.length === 0 ? (
            <div className="empty-state">{t("patFindSpecialist.empty")}</div>
          ) : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("dashboard.doctor")}</th><th>{t("common.specialization", "Specialization")}</th><th>{t("patFindSpecialist.clinicHospital")}</th><th>{t("patFindSpecialist.fee")}</th><th></th></tr></thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={`${r.id}-${r.clinic_id}`}>
                    <td>Dr. {r.full_name}</td>
                    <td>{r.specialization}</td>
                    <td>{r.clinic_name} <span className="pill">{r.org_type}</span></td>
                    <td>₹{r.consultation_fee}</td>
                    <td><button className="btn small" onClick={() => bookWith(r)}>{t("patFamily.bookAppointment")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
