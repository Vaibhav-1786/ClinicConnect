import React, { useState } from "react";
import api from "../services/api";
import { useLanguage } from "../context/LanguageContext";

/**
 * Digital Document Center — Version History (spec section 15).
 * Given any document id, fetches and lists every version in its
 * lineage (newest first), showing who uploaded each and whether it's
 * the current one.
 */
export default function DocumentVersionHistory({ documentId }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!versions) {
      setLoading(true);
      try {
        const res = await api.get(`/documents/${documentId}/versions`);
        setVersions(res.data);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div style={{ display: "inline-block" }}>
      <button className="btn btn-outline btn-sm" onClick={toggle}>{t("docCenter.versionHistory")}</button>
      {open && (
        <div className="card" style={{ marginTop: 8, padding: 10 }}>
          {loading ? (
            <div className="empty-state">{t("common.loading")}</div>
          ) : (versions || []).length === 0 ? (
            <div className="empty-state">{t("docCenter.noVersions")}</div>
          ) : (
            (versions || []).map((v) => (
              <div key={v.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                <span>
                  {t("docCenter.version")} {v.version_number}
                  {v.is_latest ? <span className="pill pill-success" style={{ marginLeft: 6 }}>{t("docCenter.current")}</span> : null}
                </span>
                <span style={{ color: "var(--text-muted)" }}>{v.uploaded_by_email || "—"} · {String(v.created_at).slice(0, 16).replace("T", " ")}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
