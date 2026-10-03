import React, { useEffect, useRef, useState } from "react";
import DashboardLayout from "../../layouts/DashboardLayout";
import api from "../../services/api";
import { useLanguage } from "../../context/LanguageContext";

const EXAMPLES_KEYS = [
  "aiAssistant.example1", "aiAssistant.example2", "aiAssistant.example3",
  "aiAssistant.example4", "aiAssistant.example5",
];

function ResultsTable({ results }) {
  if (!results || results.length === 0) return null;
  const columns = Object.keys(results[0]).filter((k) => typeof results[0][k] !== "object");
  return (
    <div style={{ overflowX: "auto", marginTop: 10 }}>
      <div className="table-wrap"><table>
        <thead><tr>{columns.map((c) => <th key={c}>{c.replace(/_/g, " ")}</th>)}</tr></thead>
        <tbody>
          {results.slice(0, 50).map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c}>{String(r[c] ?? "—")}</td>)}</tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export default function AdminAIAssistant() {
  const { t } = useLanguage();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || sending) return;
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    setSending(true);
    try {
      const res = await api.post("/admin/ai/chat", { message });
      setMessages((prev) => [...prev, {
        role: "assistant", content: res.data.reply,
        results: res.data.results, resultKind: res.data.result_kind, resultCount: res.data.result_count,
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: err.response?.data?.error || t("aiAssistant.error") }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <DashboardLayout title={t("aiAssistant.title")}>
      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: "var(--text-muted)" }}>{t("aiAssistant.hint")}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {EXAMPLES_KEYS.map((k) => (
            <button key={k} className="btn btn-outline btn-sm" onClick={() => send(t(k))}>{t(k)}</button>
          ))}
        </div>
      </div>

      <div className="card" style={{ minHeight: 360, display: "flex", flexDirection: "column" }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", maxHeight: 480, marginBottom: 12 }}>
          {messages.length === 0 && <div className="empty-state">{t("aiAssistant.emptyState")}</div>}
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 14, textAlign: m.role === "user" ? "right" : "left" }}>
              <div style={{
                display: "inline-block", maxWidth: "85%", padding: "8px 12px", borderRadius: 10,
                background: m.role === "user" ? "var(--primary)" : "var(--bg-subtle)",
                color: m.role === "user" ? "#fff" : "var(--text)", textAlign: "left",
              }}>
                {m.content}
              </div>
              {m.role === "assistant" && m.results && <ResultsTable results={m.results} />}
            </div>
          ))}
          {sending && <div className="empty-state">{t("common.loading")}</div>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", gap: 8 }}>
          <input className="input" style={{ margin: 0, flex: 1 }} value={input} onChange={(e) => setInput(e.target.value)}
                 placeholder={t("aiAssistant.placeholder")} disabled={sending} />
          <button className="btn btn-sm" type="submit" disabled={sending}>{t("aiAssistant.send")}</button>
        </form>
      </div>
    </DashboardLayout>
  );
}