import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const EMPTY = { title: "", chief_complaint: "", examination: "", assessment: "", plan: "", follow_up: "" };

export default function NoteTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const FIELDS = [
    ["chief_complaint", t("docNotes.chiefComplaint")], ["examination", t("docNotes.examination")],
    ["assessment", t("docNotes.assessment")], ["plan", t("docNotes.plan")], ["follow_up", t("docNotes.followUp")],
  ];

  const load = () => {
    setLoading(true);
    api.get("/doctor/note-templates").then((r) => setTemplates(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const startAdd = () => { setForm({ ...EMPTY }); setEditingId(null); };
  const startEdit = (tpl) => {
    setForm({
      title: tpl.title, chief_complaint: tpl.chief_complaint || "", examination: tpl.examination || "",
      assessment: tpl.assessment || "", plan: tpl.plan || "", follow_up: tpl.follow_up || "",
    });
    setEditingId(tpl.id);
  };

  const save = async () => {
    if (!form.title.trim()) { showToast(t("docNotes.titleRequired"), "error"); return; }
    try {
      if (editingId) {
        await api.put(`/doctor/note-templates/${editingId}`, form);
        showToast(t("docNotes.updated"), "success");
      } else {
        await api.post("/doctor/note-templates", form);
        showToast(t("docNotes.created"), "success");
      }
      setForm(null); setEditingId(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("docNotes.saveFailed"), "error");
    }
  };

  const remove = async (tpl) => {
    if (!window.confirm(t("docNotes.confirmDelete").replace("{title}", tpl.title))) return;
    try {
      await api.delete(`/doctor/note-templates/${tpl.id}`);
      showToast(t("docNotes.deleted"), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("docNotes.deleteFailed"), "error");
    }
  };

  const duplicate = async (tpl) => {
    try {
      await api.post(`/doctor/note-templates/${tpl.id}/duplicate`);
      showToast(t("docNotes.duplicated"), "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("docNotes.duplicateFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("nav.noteTemplates")}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>{t("docNotes.yourTemplates")}</h3>
          <button className="btn small" onClick={startAdd}>+ {t("docNotes.newTemplate")}</button>
        </div>
        <p style={{ color: "var(--text-muted)" }}>{t("docNotes.hint")}</p>
        {loading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : templates.length === 0 ? (
          <div className="empty-state">{t("docNotes.empty")}</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("docNotes.title")}</th><th>{t("docNotes.chiefComplaint")}</th><th>{t("common.actions")}</th></tr></thead>
            <tbody>
              {templates.map((tpl) => (
                <tr key={tpl.id}>
                  <td>{tpl.title}</td>
                  <td style={{ color: "var(--text-muted)" }}>{tpl.chief_complaint?.slice(0, 60) || "—"}</td>
                  <td>
                    <button className="btn small secondary" onClick={() => startEdit(tpl)}>{t("common.edit")}</button>
                    <button className="btn small secondary" style={{ marginLeft: 6 }} onClick={() => duplicate(tpl)}>{t("docNotes.duplicate")}</button>
                    <button className="btn small danger" style={{ marginLeft: 6 }} onClick={() => remove(tpl)}>{t("common.delete")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {form && (
        <div className="card">
          <h3>{editingId ? t("docNotes.editTemplate") : t("docNotes.newTemplate")}</h3>
          <label>{t("docNotes.title")} *</label>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Common Cold Follow-up" />
          <div className="grid grid-3">
            {FIELDS.map(([key, label]) => (
              <div key={key}>
                <label>{label}</label>
                <textarea rows={3} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </div>
            ))}
          </div>
          <button className="btn" onClick={save}>{editingId ? t("patFamily.saveChanges") : t("docNotes.createTemplate")}</button>
          <button className="btn secondary" style={{ marginLeft: 8 }} onClick={() => { setForm(null); setEditingId(null); }}>{t("common.cancel")}</button>
        </div>
      )}
    </DashboardLayout>
  );
}
