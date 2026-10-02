import React, { useEffect, useRef, useState } from "react";
import api from "../services/api";
import { useToast } from "../context/ToastContext";

const POLL_INTERVAL_MS = 1500;

export default function VideoCallRoom({ role, appointmentId }) {
  const [status, setStatus] = useState(null); // server-reported status/can_join_now
  const [session, setSession] = useState(null);
  const [connectionState, setConnectionState] = useState("idle"); // idle | connecting | connected | disconnected | ended
  const [elapsed, setElapsed] = useState(0);
  const { showToast } = useToast();

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const pollRef = useRef(null);
  const lastSignalIdRef = useRef(0);
  const timerRef = useRef(null);

  const loadStatus = () => {
    api.get(`/video/appointment/${appointmentId}/status`)
      .then((r) => { setStatus(r.data); setSession(r.data.session); })
      .catch((err) => showToast(err.response?.data?.error || "Could not load consultation status", "error"));
  };
  useEffect(() => { loadStatus(); return () => cleanup(); /* eslint-disable-next-line */ }, []);

  const cleanup = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null; }
  };

  const sendSignal = async (sessionId, type, payload) => {
    await api.post(`/video/session/${sessionId}/signal`, { type, payload });
  };

  const handleRemoteSignal = async (pc, sessionId, sig) => {
    if (sig.signal_type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal(sessionId, "answer", answer);
    } else if (sig.signal_type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));
    } else if (sig.signal_type === "ice-candidate") {
      try { await pc.addIceCandidate(new RTCIceCandidate(sig.payload)); } catch (e) { /* benign if pc not ready yet */ }
    } else if (sig.signal_type === "leave") {
      showToast("The other participant left the call", "error");
      setConnectionState("disconnected");
    }
  };

  const startPolling = (pc, sessionId) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/video/session/${sessionId}/signals?since=${lastSignalIdRef.current}`);
        for (const sig of res.data) {
          lastSignalIdRef.current = sig.id;
          await handleRemoteSignal(pc, sessionId, sig);
        }
      } catch (e) { /* transient poll failure, next tick retries */ }
    }, POLL_INTERVAL_MS);
  };

  const join = async () => {
    setConnectionState("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const res = await api.post(`/video/appointment/${appointmentId}/join`);
      const { session: newSession, ice_servers } = res.data;
      setSession(newSession);

      const pc = new RTCPeerConnection({ iceServers: ice_servers });
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) sendSignal(newSession.id, "ice-candidate", event.candidate.toJSON());
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") setConnectionState("connected");
        else if (["disconnected", "failed", "closed"].includes(pc.connectionState)) setConnectionState("disconnected");
      };

      startPolling(pc, newSession.id);

      // Fixed roles avoid offer/answer glare: the patient always initiates.
      if (role === "patient") {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal(newSession.id, "offer", offer);
      }

      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (err) {
      setConnectionState("idle");
      if (err.name === "NotAllowedError") {
        showToast("Camera/microphone access is required to join the consultation.", "error");
      } else {
        showToast(err.response?.data?.error || "Could not join the consultation", "error");
      }
    }
  };

  const leave = async () => {
    try {
      if (session) await api.post(`/video/session/${session.id}/leave`);
    } catch (e) { /* best-effort */ }
    cleanup();
    setConnectionState("ended");
  };

  const endForBoth = async () => {
    try {
      await api.post(`/video/appointment/${appointmentId}/end`);
      showToast("Consultation ended", "success");
    } catch (err) {
      showToast(err.response?.data?.error || "Could not end consultation", "error");
    }
    cleanup();
    setConnectionState("ended");
  };

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  if (!status) return <div className="empty-state">Loading...</div>;

  if (status.appointment_status && ["CANCELLED", "NO_SHOW", "COMPLETED"].includes(status.appointment_status) && connectionState === "idle") {
    return <div className="empty-state">This appointment is {status.appointment_status.toLowerCase()} — video consultation is not available.</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <span className={`badge ${connectionState === "connected" ? "CONFIRMED" : connectionState === "disconnected" || connectionState === "ended" ? "CANCELLED" : "PENDING"}`}>
            {connectionState === "idle" ? "Not started" : connectionState}
          </span>
          {connectionState === "connected" && <span style={{ marginLeft: 10 }}>⏱ {fmt(elapsed)}</span>}
        </div>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Scheduled: {status.scheduled_date} {String(status.scheduled_time).slice(0,5)}
        </span>
      </div>

      <div className="grid grid-2" style={{ gap: 12 }}>
        <div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 4px" }}>You</p>
          <video ref={localVideoRef} autoPlay playsInline muted style={{ width: "100%", background: "#000", borderRadius: 8 }} />
        </div>
        <div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 4px" }}>Other participant</p>
          <video ref={remoteVideoRef} autoPlay playsInline style={{ width: "100%", background: "#000", borderRadius: 8 }} />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        {connectionState === "idle" && (
          status.can_join_now ? (
            <button className="btn" onClick={join}>Join Consultation</button>
          ) : (
            <div className="empty-state">You can join up to 15 minutes before the scheduled time.</div>
          )
        )}
        {["connecting", "connected"].includes(connectionState) && (
          <>
            <button className="btn danger" onClick={leave}>Leave Call</button>
            {role === "doctor" && (
              <button className="btn secondary" style={{ marginLeft: 8 }} onClick={endForBoth}>End Consultation</button>
            )}
          </>
        )}
        {["disconnected", "ended"].includes(connectionState) && (
          <div className="empty-state">The call has ended.</div>
        )}
      </div>
    </div>
  );
}
