import requests as http
from flask import Blueprint, request, jsonify, g

from app.utils.db import query
from app.utils.auth import require_auth
from app.utils.helpers import add_audit
from config import Config

bp = Blueprint("ai", __name__, url_prefix="/api/ai")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

MAX_MESSAGE_LEN = 2000
MAX_HISTORY_MESSAGES = 20

SYSTEM_PROMPT = """You are "Clara", the clinic information and appointment assistant \
built into the ClinicConnect patient dashboard.

You may help patients with:
- Navigating the clinic management system and finding features on their dashboard
- Questions about their own appointments and appointment status
- General information about how the clinic/appointment/payment process works
- General health information and explaining basic medical terminology in plain language
- Helping a patient prepare questions to ask their doctor at their next visit
- General, non-personalized explanations of what a class of medication is typically for
- General guidance about the payment/appointment process in this app
- If a patient describes a general concern (e.g. "I have tooth pain" or "I need a skin specialist")
  and just wants to know which kind of doctor to see, you may point them to the "Find the Right
  Specialist" feature on their dashboard — this is navigation help, not a diagnosis, and you should
  still encourage them to describe their symptoms to the doctor directly

You must NEVER:
- Diagnose a medical condition or tell a patient what disease/condition they have
- Claim to be a doctor or claim to replace professional medical advice
- Prescribe, recommend a dosage, or tell a patient to change/stop any medication
- Give dangerous, unverified, or emergency medical instructions
- Reveal, guess, or discuss any other patient's information

If a patient describes symptoms or asks something that requires a professional medical \
assessment, clearly and kindly recommend they book an appointment or speak with a doctor \
or, for urgent/emergency symptoms, seek emergency care immediately. Keep responses concise, \
warm, and easy to read. Use the patient context provided to you (if any) to personalize \
answers about their own appointments, but never fabricate appointment data that wasn't \
given to you."""


def _build_patient_context():
    """Non-sensitive, own-account-only context for the authenticated patient."""
    patient = query(
        "SELECT full_name, patient_code FROM patients WHERE id=%s",
        (g.profile_id,), fetchone=True,
    )
    if not patient:
        return "No patient profile found."

    upcoming = query(
        """SELECT a.appointment_date, a.appointment_time, a.status,
                  d.full_name AS doctor_name, c.name AS clinic_name
           FROM appointments a
           JOIN doctors d ON d.id = a.doctor_id
           JOIN clinics c ON c.id = a.clinic_id
           WHERE a.patient_id=%s AND a.status IN ('CONFIRMED','CHECKED_IN')
           ORDER BY a.appointment_date ASC, a.appointment_time ASC
           LIMIT 5""",
        (g.profile_id,),
    )
    pending = query(
        """SELECT ar.requested_date, ar.requested_time, ar.status,
                  d.full_name AS doctor_name, c.name AS clinic_name
           FROM appointment_requests ar
           JOIN doctors d ON d.id = ar.doctor_id
           JOIN clinics c ON c.id = ar.clinic_id
           WHERE ar.patient_id=%s AND ar.status IN ('PENDING','UNDER_REVIEW')
           ORDER BY ar.created_at DESC
           LIMIT 5""",
        (g.profile_id,),
    )

    lines = [f"Patient name: {patient['full_name']}"]
    if upcoming:
        lines.append("Upcoming confirmed appointments:")
        for a in upcoming:
            lines.append(
                f"- Dr. {a['doctor_name']} at {a['clinic_name']} on {a['appointment_date']} "
                f"{str(a['appointment_time'])[:5]} ({a['status']})"
            )
    else:
        lines.append("No upcoming confirmed appointments.")

    if pending:
        lines.append("Pending appointment requests (not yet confirmed):")
        for r in pending:
            lines.append(
                f"- Dr. {r['doctor_name']} at {r['clinic_name']}, requested for "
                f"{r['requested_date']} {str(r['requested_time'])[:5]} ({r['status']})"
            )

    return "\n".join(lines)


@bp.post("/chat")
@require_auth(["patient"])
def chat():
    if not Config.OPENROUTER_API_KEY:
        return jsonify({"error": "The AI assistant is not configured on this server yet."}), 503

    data = request.get_json(force=True) or {}
    message = (data.get("message") or "").strip()
    history = data.get("history") or []

    if not message:
        return jsonify({"error": "Message cannot be empty"}), 400
    if len(message) > MAX_MESSAGE_LEN:
        return jsonify({"error": f"Message is too long (max {MAX_MESSAGE_LEN} characters)"}), 400
    if not isinstance(history, list):
        return jsonify({"error": "Invalid conversation history"}), 400

    # Only keep the well-formed, recent tail of the history; ignore anything malformed
    # rather than failing the whole request.
    clean_history = []
    for item in history[-MAX_HISTORY_MESSAGES:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            clean_history.append({"role": role, "content": content[:MAX_MESSAGE_LEN]})

    try:
        patient_context = _build_patient_context()
    except Exception:
        patient_context = "Patient context is temporarily unavailable."

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": f"Authenticated patient context:\n{patient_context}"},
        *clean_history,
        {"role": "user", "content": message},
    ]

    try:
        resp = http.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {Config.OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": Config.OPENROUTER_SITE_URL,
                "X-Title": Config.OPENROUTER_APP_NAME,
            },
            json={
                "model": Config.OPENROUTER_MODEL,
                "messages": messages,
                "temperature": 0.4,
                "max_tokens": 600,
            },
            timeout=25,
        )
    except http.exceptions.Timeout:
        return jsonify({"error": "The AI assistant took too long to respond. Please try again."}), 504
    except http.exceptions.RequestException:
        return jsonify({"error": "Could not reach the AI service. Please check your connection and try again."}), 502

    if resp.status_code == 401:
        return jsonify({"error": "The AI assistant is misconfigured on the server. Please contact support."}), 503
    if resp.status_code == 429:
        return jsonify({"error": "The AI assistant is receiving too many requests right now. Please try again shortly."}), 429
    if resp.status_code >= 400:
        return jsonify({"error": "The AI assistant is currently unavailable. Please try again later."}), 502

    try:
        payload = resp.json()
        reply = payload["choices"][0]["message"]["content"].strip()
    except (ValueError, KeyError, IndexError, TypeError):
        return jsonify({"error": "The AI assistant returned an unexpected response. Please try again."}), 502

    if not reply:
        return jsonify({"error": "The AI assistant returned an empty response. Please try again."}), 502

    add_audit(g.user_id, "patient", "AI_CHAT", message[:200])
    return jsonify({"reply": reply})
