import React, { useRef, useState } from "react";
import api from "../services/api";
import { useToast } from "../context/ToastContext";

/**
 * Records a short voice message from the mic and uploads it to the
 * conversation thread for the given appointment. Used by both the doctor
 * and patient "Message" panels so a voice note recorded on one side can be
 * played back on the other via <AudioMessagePlayer>.
 */
export default function VoiceRecorderButton({ appointmentId, onSent, disabled }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const { showToast } = useToast();

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      showToast("Voice recording isn't supported in this browser. Try Chrome or Edge.", "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        if (blob.size === 0) return;
        setIsUploading(true);
        try {
          const formData = new FormData();
          formData.append("appointment_id", appointmentId);
          formData.append("audio", blob, `voice-message.${mimeType.includes("webm") ? "webm" : "ogg"}`);
          await api.post("/messages", formData);
          onSent && onSent();
        } catch (err) {
          showToast(err.response?.data?.error || "Could not send voice message", "error");
        } finally {
          setIsUploading(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      showToast("Microphone access was denied or unavailable.", "error");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  return (
    <button
      type="button"
      className={`btn small ${isRecording ? "danger" : "secondary"}`}
      disabled={disabled || isUploading}
      onClick={isRecording ? stopRecording : startRecording}
      title={isRecording ? "Stop and send" : "Record a voice message"}
    >
      {isUploading ? "Sending…" : isRecording ? "⏹ Stop & Send" : "🎤 Voice Message"}
    </button>
  );
}