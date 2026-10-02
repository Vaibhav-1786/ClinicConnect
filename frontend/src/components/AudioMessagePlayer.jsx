import React, { useEffect, useState } from "react";
import api from "../services/api";

/**
 * Plays back a voice message. The audio file is behind authenticated API
 * routes (only the patient/doctor on that appointment may access it), so a
 * plain <audio src="/api/..."> tag won't work — the browser can't attach an
 * Authorization header to a media element's request. Instead we fetch the
 * bytes ourselves via the authenticated axios instance and hand the player
 * a local blob: URL.
 */
export default function AudioMessagePlayer({ messageId }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl;
    let cancelled = false;
    api.get(`/messages/audio/${messageId}`, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [messageId]);

  if (error) return <span style={{ fontSize: 12, color: "var(--danger)" }}>Voice message unavailable</span>;
  if (!src) return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading voice message…</span>;
  return <audio controls src={src} style={{ height: 32, maxWidth: 240 }} />;
}