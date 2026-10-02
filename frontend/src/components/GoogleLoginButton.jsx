import React, { useEffect, useRef, useState } from "react";
import api from "../services/api";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GSI_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let gsiScriptPromise = null;
function loadGsiScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gsiScriptPromise) return gsiScriptPromise;
  gsiScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Failed to load Google Sign-In"));
    document.head.appendChild(script);
  });
  return gsiScriptPromise;
}

/**
 * Real "Continue with Google" for the Patient Login page only.
 *
 * Flow:
 *  1. Google Identity Services renders its own official button and, on
 *     click, authenticates the patient directly with Google.
 *  2. Google hands us back a signed ID token (JWT) — we never see or
 *     collect a password.
 *  3. That token is POSTed to the Flask backend, which verifies it
 *     server-side, finds/creates the patient, and returns our own JWT.
 *  4. The parent Login page logs the patient in via AuthContext exactly
 *     like a normal email/password login.
 */
export default function GoogleLoginButton({ onSuccess, onError, disabled }) {
  const buttonRef = useRef(null);
  const [status, setStatus] = useState(GOOGLE_CLIENT_ID ? "loading" : "unconfigured");

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;

    const handleCredential = async (response) => {
      try {
        const res = await api.post("/auth/google", { credential: response.credential });
        onSuccess?.(res.data);
      } catch (err) {
        const status_ = err.response?.status;
        let message = "Google sign-in failed. Please try again.";
        if (status_ === 401) message = "Your Google session could not be verified. Please try again.";
        else if (status_ === 409) message = err.response?.data?.error || "This email is already used differently.";
        else if (!err.response) message = "Network error while contacting the server.";
        onError?.(message);
      }
    };

    loadGsiScript()
      .then(() => {
        if (cancelled) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredential,
          ux_mode: "popup",
        });
        if (buttonRef.current) {
          window.google.accounts.id.renderButton(buttonRef.current, {
            theme: document.documentElement.getAttribute("data-theme") === "dark" ? "filled_black" : "outline",
            size: "large",
            width: Math.max(200, Math.min(320, Math.floor(buttonRef.current.clientWidth || 320))),
            text: "continue_with",
            shape: "rectangular",
          });
        }
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          onError?.("Could not load Google Sign-In. Check your network connection.");
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!GOOGLE_CLIENT_ID) return null; // Not configured — silently omit rather than showing a fake button.

  return (
    <div className={`google-login-wrap${disabled ? " disabled" : ""}`}>
      {status === "loading" && <div className="google-login-placeholder">Loading Google Sign-In…</div>}
      {status === "error" && <div className="google-login-placeholder error">Google Sign-In unavailable</div>}
      <div ref={buttonRef} style={{ display: status === "ready" ? "flex" : "none", justifyContent: "center" }} />
    </div>
  );
}
