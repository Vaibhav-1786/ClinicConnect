import React, { useEffect, useRef, useState } from "react";
import api from "../services/api";

const WELCOME = {
  role: "assistant",
  content:
    "Hi! I'm Clara, your clinic assistant. I can help with appointment status, clinic info, " +
    "general health questions, and preparing questions for your doctor. I can't diagnose " +
    "conditions or change prescriptions — for anything like that, please consult your doctor.",
};

/**
 * Real AI assistant for the patient dashboard: floating button -> chat panel.
 * Talks only to POST /api/ai/chat (Flask backend), which in turn calls
 * OpenRouter using a key that is stored only in the backend .env — the key
 * never reaches this component or the browser.
 */
export default function AIChatAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, sending]);

  const send = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setError("");
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    try {
      // Send the conversation so far (excluding the fixed welcome message) as history.
      const history = nextMessages
        .filter((m) => m !== WELCOME)
        .slice(0, -1)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await api.post("/ai/chat", { message: text, history });
      setMessages((prev) => [...prev, { role: "assistant", content: res.data.reply }]);
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        (err.code === "ECONNABORTED"
          ? "The assistant took too long to respond. Please try again."
          : !err.response
          ? "Network error — please check your connection and try again."
          : "Something went wrong. Please try again.");
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="ai-assistant">
      {open && (
        <div className="ai-panel" role="dialog" aria-label="AI Assistant">
          <div className="ai-panel-header">
            <div className="ai-panel-title">
              <span className="ai-avatar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 3l1.8 4.6L18 9.3l-4.2 1.7L12 15.6l-1.8-4.6L6 9.3l4.2-1.7L12 3z" fill="currentColor"/>
                  <path d="M19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" fill="currentColor"/>
                </svg>
              </span>
              <div>
                <div className="ai-title-main">Clara</div>
                <div className="ai-title-sub">Clinic &amp; appointment assistant</div>
              </div>
            </div>
            <button
              type="button"
              className="ai-icon-btn"
              aria-label="Minimize"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          <div className="ai-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="empty-state">Ask me anything about your appointments or the clinic.</div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`ai-msg ai-msg-${m.role}`}>
                <div className="ai-bubble">{m.content}</div>
              </div>
            ))}
            {sending && (
              <div className="ai-msg ai-msg-assistant">
                <div className="ai-bubble ai-typing">
                  <span className="ai-dot" />
                  <span className="ai-dot" />
                  <span className="ai-dot" />
                </div>
              </div>
            )}
            {error && <div className="ai-error">{error}</div>}
          </div>

          <form className="ai-input-row" onSubmit={send}>
            <input
              className="input"
              style={{ margin: 0 }}
              placeholder="Type a message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
              maxLength={2000}
              aria-label="Message"
            />
            <button className="btn ai-send-btn" type="submit" disabled={sending || !input.trim()}>
              {sending ? "…" : "Send"}
            </button>
          </form>
          <div className="ai-disclaimer">
            Clara gives general information only and can't replace advice from your doctor.
          </div>
        </div>
      )}

      <button
        type="button"
        className="ai-fab"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close AI Assistant" : "Open AI Assistant"}
        title="AI Assistant"
      >
        {open ? (
          "✕"
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3l1.8 4.6L18 9.3l-4.2 1.7L12 15.6l-1.8-4.6L6 9.3l4.2-1.7L12 3z" fill="currentColor"/>
            <path d="M19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" fill="currentColor"/>
          </svg>
        )}
      </button>
    </div>
  );
}