import os

from flask import Blueprint, request, jsonify, g, current_app, send_from_directory  # type: ignore[reportMissingImports]
from werkzeug.utils import secure_filename  # type: ignore[reportMissingImports]

from app.utils.db import query, execute
from app.utils.auth import require_auth
from config import Config

bp = Blueprint("messages", __name__, url_prefix="/api/messages")

ALLOWED_AUDIO_EXT = {"webm", "ogg", "mp3", "wav", "m4a"}


def _authorized_for_appointment(appointment_id):
    appt = query("SELECT * FROM appointments WHERE id=%s", (appointment_id,), fetchone=True)
    if not appt:
        return None
    if g.role == "patient" and appt["patient_id"] != g.profile_id:
        return None
    if g.role == "doctor" and appt["doctor_id"] != g.profile_id:
        return None
    # Messaging only unlocked once the appointment has been approved/confirmed
    if appt["status"] not in ("CONFIRMED", "CHECKED_IN", "IN_CONSULTATION", "COMPLETED"):
        return None
    return appt


@bp.get("/<int:appointment_id>")
@require_auth(["patient", "doctor"])
def get_conversation(appointment_id):
    appt = _authorized_for_appointment(appointment_id)
    if not appt:
        return jsonify({"error": "Not authorized or appointment not yet approved"}), 403
    msgs = query(
        "SELECT * FROM patient_messages WHERE appointment_id=%s ORDER BY created_at",
        (appointment_id,),
    )
    execute(
        "UPDATE patient_messages SET is_read=1 WHERE appointment_id=%s AND sender_role != %s",
        (appointment_id, g.role),
    )
    return jsonify(msgs)


@bp.post("")
@require_auth(["patient", "doctor"])
def send_message():
    # Voice messages arrive as multipart/form-data with an audio file attached;
    # text messages arrive as plain JSON. Both share the same auth checks.
    if request.files and "audio" in request.files:
        appointment_id = request.form.get("appointment_id")
        if not appointment_id:
            return jsonify({"error": "appointment_id required"}), 400
        appointment_id = int(appointment_id)
        appt = _authorized_for_appointment(appointment_id)
        if not appt:
            return jsonify({"error": "Not authorized or appointment not yet approved"}), 403

        audio = request.files["audio"]
        ext = audio.filename.rsplit(".", 1)[-1].lower() if "." in audio.filename else "webm"
        if ext not in ALLOWED_AUDIO_EXT:
            return jsonify({"error": "Unsupported audio format"}), 400

        upload_dir = os.path.join(current_app.root_path, "..", Config.UPLOAD_FOLDER, "voice_messages")
        os.makedirs(upload_dir, exist_ok=True)
        safe_name = secure_filename(f"appt{appointment_id}_{g.role}_{g.profile_id}_{os.urandom(4).hex()}.{ext}")
        audio.save(os.path.join(upload_dir, safe_name))

        msg_id = execute(
            "INSERT INTO patient_messages (appointment_id, sender_role, sender_id, message, message_type, audio_path) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (appointment_id, g.role, g.profile_id, "[Voice message]", "audio", f"voice_messages/{safe_name}"),
        )
        return jsonify({"id": msg_id}), 201

    data = request.get_json(force=True) or {}
    appointment_id = data.get("appointment_id")
    message = data.get("message")
    if not appointment_id or not message:
        return jsonify({"error": "appointment_id and message required"}), 400
    appt = _authorized_for_appointment(appointment_id)
    if not appt:
        return jsonify({"error": "Not authorized or appointment not yet approved"}), 403
    msg_id = execute(
        "INSERT INTO patient_messages (appointment_id, sender_role, sender_id, message) VALUES (%s,%s,%s,%s)",
        (appointment_id, g.role, g.profile_id, message),
    )
    return jsonify({"id": msg_id}), 201


@bp.get("/audio/<int:message_id>")
@require_auth(["patient", "doctor"])
def get_audio(message_id):
    """Authenticated audio playback: only the patient/doctor on the
    appointment this message belongs to may stream it."""
    msg = query("SELECT * FROM patient_messages WHERE id=%s", (message_id,), fetchone=True)
    if not msg or msg["message_type"] != "audio" or not msg["audio_path"]:
        return jsonify({"error": "Not found"}), 404
    appt = _authorized_for_appointment(msg["appointment_id"])
    if not appt:
        return jsonify({"error": "Not authorized"}), 403

    upload_root = os.path.join(current_app.root_path, "..", Config.UPLOAD_FOLDER)
    directory, filename = os.path.split(msg["audio_path"])
    return send_from_directory(os.path.join(upload_root, directory), filename, as_attachment=False)