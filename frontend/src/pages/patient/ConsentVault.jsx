import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const EMPTY = { doc_type: "consent_form", title: "", notes: "" };

export default function ConsentVault() {
  const [docs, setDocs] = useState([]);
  const [form, setForm] = useState(null);
  const [signing, setSigning] = useState(null);
  const [signatureName, setSignatureName] = useState("");
  const { showToast } = useToast();
  const { t } = useLanguage();

  const DOC_TYPES = [
    ["consent_form", t("patConsentVault.typeConsentForm")], ["insurance", t("patConsentVault.typeInsurance")],
    ["id_proof", t("patConsentVault.typeIdProof")], ["other", t("patConsentVault.typeOther")],
  ];

  const load = () => api.get("/consent-vault").then((r) => setDocs(r.data));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.title.trim()) { showToast(t("patConsentVault.titleRequired"), "error"); return; }
    try {
      await api.post("/consent-vault", form);
      showToast(t("patConsentVault.added"), "success");
      setForm(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("patConsentVault.addFailed"), "error");
    }
  };

  const sign = async () => {
    if (!signatureName.trim()) { showToast(t("patConsentVault.signNameRequired"), "error"); return; }
    try {
      await api.post(`/consent-vault/${signing.id}/sign`, { signature_name: signatureName });
      showToast(t("patConsentVault.signed"), "success");
      setSigning(null); setSignatureName("");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("patConsentVault.signFailed"), "error");
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(t("patConsentVault.confirmDelete").replace("{title}", doc.title))) return;
    await api.delete(`/consent-vault/${doc.id}`);
    load();
  };

  return (
    <DashboardLayout title={t("patConsentVault.title")}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>{t("patConsentVault.heading")}</h3>
          <button className="btn small" onClick={() => setForm({ ...EMPTY })}>{t("patConsentVault.addDocument")}</button>
        </div>
        <p style={{ color: "var(--text-muted)" }}>{t("patConsentVault.intro")}</p>

        {docs.length === 0 ? (
          <div className="empty-state">{t("patConsentVault.empty")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("patConsentVault.colTitle")}</th><th>{t("patConsentVault.colType")}</th><th>{t("patConsentVault.colStatus")}</th><th>{t("patConsentVault.colActions")}</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.title}{d.notes ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{d.notes}</div> : null}</td>
                  <td>{DOC_TYPES.find(([k]) => k === d.doc_type)?.[1] || d.doc_type}</td>
                  <td>
                    {d.is_signed
                      ? <span className="badge CONFIRMED">{t("patConsentVault.signedBy").replace("{name}", d.signature_name)}</span>
                      : <span className="badge PENDING">{t("patConsentVault.unsigned")}</span>}
                  </td>
                  <td>
                    {!d.is_signed && d.doc_type === "consent_form" && (
                      <button className="btn small secondary" onClick={() => { setSigning(d); setSignatureName(""); }}>{t("patConsentVault.sign")}</button>
                    )}
                    <button className="btn small danger" style={{ marginLeft: 6 }} onClick={() => remove(d)}>{t("patConsentVault.delete")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {form && (
        <div className="card">
          <h3>{t("patConsentVault.addFormTitle")}</h3>
          <div className="grid grid-3">
            <div>
              <label>{t("patConsentVault.typeLabel")}</label>
              <select value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })}>
                {DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div><label>{t("patConsentVault.titleLabel")}</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          </div>
          <label>{t("patConsentVault.notesLabel")}</label>
          <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <button className="btn" onClick={save}>{t("patConsentVault.save")}</button>
          <button className="btn secondary" style={{ marginLeft: 8 }} onClick={() => setForm(null)}>{t("patConsentVault.cancel")}</button>
        </div>
      )}

      {signing && (
        <div className="card">
          <h3>{t("patConsentVault.signFormTitle").replace("{title}", signing.title)}</h3>
          <label>{t("patConsentVault.signInstruction")}</label>
          <input className="input" value={signatureName} onChange={(e) => setSignatureName(e.target.value)} placeholder={t("patConsentVault.fullNamePlaceholder")} />
          <button className="btn" onClick={sign}>{t("patConsentVault.confirmSignature")}</button>
          <button className="btn secondary" style={{ marginLeft: 8 }} onClick={() => setSigning(null)}>{t("patConsentVault.cancel")}</button>
        </div>
      )}
    </DashboardLayout>
  );
}
