import React, { useEffect, useRef, useState } from "react";
import api from "../services/api";
import { useLanguage } from "../context/LanguageContext";

const CATEGORY_ICON = {
  appointment: "📅", payment: "💳", prescription: "💊",
  laboratory: "🧪", follow_up: "⏳", system: "🔔", emergency: "🚨",
};

const CATEGORIES = ["appointment", "payment", "prescription", "laboratory", "follow_up", "emergency", "system"];

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState({});
  const boxRef = useRef(null);
  const { t } = useLanguage();

  const load = (category = categoryFilter) => {
    const q = category ? `?category=${category}` : "";
    api.get(`/notifications${q}`).then((r) => {
      setItems(r.data);
    }).catch(() => {});
    api.get("/notifications/counts").then((r) => {
      setUnread(Object.values(r.data).reduce((a, b) => a + b, 0));
    }).catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(() => load(), 30000); // poll every 30s for new alerts
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { load(categoryFilter); }, [categoryFilter]);

  useEffect(() => {
    const onClickOutside = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setShowPrefs(false); } };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const toggle = () => {
    setOpen((o) => !o);
    if (!open) load();
  };

  const markOne = async (n) => {
    if (!n.is_read) {
      await api.post(`/notifications/${n.id}/read`);
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, is_read: 1 } : i)));
      setUnread((u) => Math.max(0, u - 1));
    }
  };

  const archiveOne = async (e, n) => {
    e.stopPropagation();
    await api.post(`/notifications/${n.id}/archive`);
    setItems((prev) => prev.filter((i) => i.id !== n.id));
    if (!n.is_read) setUnread((u) => Math.max(0, u - 1));
  };

  const markAll = async () => {
    await api.post("/notifications/read-all", categoryFilter ? { category: categoryFilter } : {});
    setItems((prev) => prev.map((i) => ({ ...i, is_read: 1 })));
    load();
  };

  const openPrefs = async () => {
    setShowPrefs((s) => !s);
    if (!showPrefs) {
      const r = await api.get("/notifications/preferences");
      setPrefs(r.data);
    }
  };

  const togglePref = async (category) => {
    const next = { ...prefs, [category]: !prefs[category] };
    setPrefs(next);
    await api.put("/notifications/preferences", { [category]: next[category] });
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        onClick={toggle}
        title={t("notif.title") || "Notifications"}
        style={{
          position: "relative", background: "transparent", border: "1px solid var(--border)",
          borderRadius: 8, width: "var(--icon-btn, 36px)", height: "var(--icon-btn, 36px)", cursor: "pointer", fontSize: 16, color: "var(--text)",
        }}
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -4, right: -4, background: "var(--danger)", color: "#fff",
            fontSize: 10, fontWeight: 700, borderRadius: 999, minWidth: 16, height: 16,
            display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="card notif-panel" style={{
          zIndex: 1100, padding: 0, boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
        }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
            <strong>{t("notif.title") || "Notifications"}</strong>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn small secondary" style={{ padding: "2px 8px", fontSize: 12 }} onClick={openPrefs}>
                {t("notif.preferences")}
              </button>
              {unread > 0 && (
                <button className="btn small secondary" style={{ padding: "2px 8px", fontSize: 12 }} onClick={markAll}>
                  {t("notif.markAllRead") || "Mark all read"}
                </button>
              )}
            </div>
          </div>

          {showPrefs ? (
            <div style={{ padding: 14 }}>
              <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 0 }}>{t("notif.preferencesHint")}</p>
              {CATEGORIES.map((c) => (
                <label key={c} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
                  <span>{CATEGORY_ICON[c]} {t(`notif.category.${c}`)}</span>
                  <input type="checkbox" checked={prefs[c] !== false} onChange={() => togglePref(c)} />
                </label>
              ))}
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, padding: "8px 12px", overflowX: "auto", borderBottom: "1px solid var(--border)" }}>
                <button className={`pill ${!categoryFilter ? "pill-success" : ""}`} style={{ border: "none", cursor: "pointer" }} onClick={() => setCategoryFilter(null)}>
                  {t("notif.all")}
                </button>
                {CATEGORIES.map((c) => (
                  <button key={c} className={`pill ${categoryFilter === c ? "pill-success" : ""}`} style={{ border: "none", cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => setCategoryFilter(c)}>
                    {CATEGORY_ICON[c]} {t(`notif.category.${c}`)}
                  </button>
                ))}
              </div>
              {items.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                  {t("notif.empty") || "No notifications yet."}
                </div>
              ) : (
                items.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => markOne(n)}
                    style={{
                      padding: "10px 14px", borderBottom: "1px solid var(--border)", cursor: "pointer",
                      background: n.is_read ? "transparent" : "rgba(37,99,235,0.08)",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span>{CATEGORY_ICON[n.category] || "🔔"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: n.is_read ? 400 : 700, fontSize: 13 }}>{n.title}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{n.message}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                          {new Date(n.created_at).toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={(e) => archiveOne(e, n)}
                        title={t("notif.archive")}
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 14 }}
                      >
                        🗄
                      </button>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
