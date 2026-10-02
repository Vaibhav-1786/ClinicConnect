import React, { useEffect, useState } from "react";
import api from "../services/api";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";

/** Internal-only comment thread. entityType: APPLICATION | DOCTOR | CLINIC | DOCUMENT | VERIFICATION */
export default function AdminComments({ entityType, entityId }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const { showToast } = useToast();
  const { t } = useLanguage();

  const load = () => {
    api.get(`/admin/comments/${entityType}/${entityId}`).then((r) => setComments(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, [entityType, entityId]);

  const add = async () => {
    if (!text.trim()) return;
    try {
      await api.post(`/admin/comments/${entityType}/${entityId}`, { comment: text.trim() });
      setText("");
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("adminComments.addFailed"), "error");
    }
  };

  const startEdit = (c) => { setEditingId(c.id); setEditingText(c.comment); };

  const saveEdit = async (id) => {
    try {
      await api.put(`/admin/comments/${id}`, { comment: editingText });
      setEditingId(null);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("adminComments.editFailed"), "error");
    }
  };

  const remove = async (id) => {
    if (!window.confirm(t("adminComments.confirmDelete"))) return;
    try {
      await api.delete(`/admin/comments/${id}`);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t("adminComments.deleteFailed"), "error");
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3>{t("adminComments.title")}</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("adminComments.hint")}</p>
      {comments.length === 0 ? (
        <div className="empty-state">{t("adminComments.none")}</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
          {comments.map((c) => (
            <li key={c.id} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)" }}>
                <span>{c.author_email}{c.is_edited ? ` (${t("adminComments.edited")})` : ""}</span>
                <span>{new Date(c.created_at).toLocaleString()}</span>
              </div>
              {editingId === c.id ? (
                <div style={{ marginTop: 4 }}>
                  <textarea className="input" value={editingText} onChange={(e) => setEditingText(e.target.value)} />
                  <button className="btn btn-outline btn-sm" onClick={() => saveEdit(c.id)}>{t("common.save")}</button>
                  <button className="btn btn-outline btn-sm" style={{ marginLeft: 6 }} onClick={() => setEditingId(null)}>{t("common.cancel")}</button>
                </div>
              ) : (
                <>
                  <p style={{ margin: "4px 0" }}>{c.comment}</p>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => startEdit(c)}>{t("common.edit")}</button>
                    <button className="btn btn-outline btn-sm" onClick={() => remove(c.id)}>{t("common.delete")}</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <textarea className="input" placeholder={t("adminComments.placeholder")} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn btn-sm" onClick={add}>{t("adminComments.add")}</button>
    </div>
  );
}
