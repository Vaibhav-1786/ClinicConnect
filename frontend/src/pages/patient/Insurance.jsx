import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const POLICY_TYPES = ["Individual", "Family Floater", "Group/Employer", "Government Scheme", "Other"];
const EMPTY = { provider: "", policy_number: "", member_id: "", valid_from: "", valid_until: "", policy_type: "Individual", coverage_details: "" };

export default function Insurance() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => {
    setLoading(true);
    api.get("/patient/insurance").then((r) => setPolicies(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const startAdd = () => { setForm({ ...EMPTY }); setEditingId(null); };
  const startEdit = (p) => {
    setForm({
      provider: p.provider, policy_number: p.policy_number, member_id: p.member_id || "",
      valid_from: p.valid_from || "", valid_until: p.valid_until || "",
      policy_type: p.policy_type, coverage_details: p.coverage_details || "",
    });
    setEditingId(p.id);
  };

  const save = async () => {
    try {
      if (editingId) {
        await api.put(`/patient/insurance/${editingId}`, form);
        showToast(t("patInsurance.updated"), "success");
      } else {
        await api.post("/patient/insurance", form);
        showToast(t("patInsurance.added"), "success");
      }
      setForm(null); setEditingId(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("patInsurance.saveFailed"), "error");
    }
  };

  const remove = async (p) => {
    if (!window.confirm(t("patInsurance.confirmRemove").replace("{provider}", p.provider))) return;
    try {
      await api.delete(`/patient/insurance/${p.id}`);
      showToast(t("patInsurance.removed"), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("patInsurance.removeFailed"), "error");
    }
  };

  const setPrimary = async (p) => {
    try {
      await api.post(`/patient/insurance/${p.id}/set-primary`);
      showToast(t("patInsurance.setPrimaryDone").replace("{provider}", p.provider), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("patInsurance.setPrimaryFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("nav.insurance")}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>{t("patInsurance.yourPolicies")}</h3>
          <button className="btn small" onClick={startAdd}>+ {t("patInsurance.addInsurance")}</button>
        </div>
        <p style={{ color: "var(--text-muted)" }}>{t("patInsurance.privacyNote")}</p>

        {loading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : policies.length === 0 ? (
          <div className="empty-state">{t("patInsurance.empty")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("patInsurance.provider")}</th><th>{t("patInsurance.policyNumber")}</th><th>{t("patInsurance.type")}</th><th>{t("patInsurance.valid")}</th><th>{t("patInsurance.primary")}</th><th>{t("common.actions")}</th></tr></thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id}>
                  <td>{p.provider}</td>
                  <td>{p.policy_number}</td>
                  <td>{p.policy_type}</td>
                  <td>{p.valid_from || "—"} {t("patInsurance.to")} {p.valid_until || "—"}</td>
                  <td>{p.is_primary ? <span className="badge CONFIRMED">{t("patInsurance.primary")}</span> : (
                    <button className="btn small secondary" onClick={() => setPrimary(p)}>{t("patInsurance.setPrimary")}</button>
                  )}</td>
                  <td>
                    <button className="btn small secondary" onClick={() => startEdit(p)}>{t("common.edit")}</button>
                    <button className="btn small danger" style={{ marginLeft: 6 }} onClick={() => remove(p)}>{t("common.delete")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {form && (
        <div className="card">
          <h3>{editingId ? t("patInsurance.editInsurance") : t("patInsurance.addInsurance")}</h3>
          <div className="grid grid-3">
            <div><label>{t("patInsurance.provider")} *</label><input className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></div>
            <div><label>{t("patInsurance.policyNumber")} *</label><input className="input" value={form.policy_number} onChange={(e) => setForm({ ...form, policy_number: e.target.value })} /></div>
            <div><label>{t("patInsurance.memberId")}</label><input className="input" value={form.member_id} onChange={(e) => setForm({ ...form, member_id: e.target.value })} /></div>
            <div><label>{t("patInsurance.validFrom")}</label><input type="date" className="input" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></div>
            <div><label>{t("patInsurance.validUntil")}</label><input type="date" className="input" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></div>
            <div>
              <label>{t("patInsurance.policyType")}</label>
              <select value={form.policy_type} onChange={(e) => setForm({ ...form, policy_type: e.target.value })}>
                {POLICY_TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
              </select>
            </div>
          </div>
          <label>{t("patInsurance.coverageDetails")}</label>
          <textarea rows={3} value={form.coverage_details} onChange={(e) => setForm({ ...form, coverage_details: e.target.value })} placeholder="e.g. Covers hospitalization up to Rs. 5,00,000, includes OPD" />
          <button className="btn" onClick={save}>{editingId ? t("patFamily.saveChanges") : t("patInsurance.addInsurance")}</button>
          <button className="btn secondary" style={{ marginLeft: 8 }} onClick={() => { setForm(null); setEditingId(null); }}>{t("common.cancel")}</button>
        </div>
      )}
    </DashboardLayout>
  );
}
