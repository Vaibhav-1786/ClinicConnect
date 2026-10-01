import datetime
import json

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit, add_notification

bp = Blueprint("video_consultation", __name__, url_prefix="/api/video")

# Public STUN only (no TURN service is configured in this project — most
# direct peer connections on the same network/NAT type will still work, but
# some restrictive corporate/mobile NATs may fail without a TURN relay; that
# would be a real infrastructure cost to add later, not a code change).
ICE_SERVERS = [{"urls": "stun:stun.l.google.com:19302"}]

JOIN_WINDOW_BEFORE_MIN = 15   # can join up to 15 minutes early
JOIN_WINDOW_AFTER_MIN = 120   # ...and up to 2 hours after the scheduled time


def _get_appointment_for_user(appointment_id):
    """Fetch the appointment only if the current user is either the assigned
    doctor or the booking patient — this IS the "no public meeting room"
    control: nothing here is reachable without that match."""
    appt = query("SELECT * FROM appointments WHERE id=%s", (appointment_id,), fetchone=True)
    if not appt:
        return None
    if g.role == "patient" and appt["patient_id"] == g.profile_id:
        return appt
    if g.role == "doctor" and appt["doctor_id"] == g.profile_id:
        return appt
    return None


def _within_join_window(appt):
    appt_date = appt["appointment_date"]
    appt_time = appt["appointment_time"]
    if isinstance(appt_date, str):
        appt_date = datetime.datetime.strptime(appt_date, "%Y-%m-%d").date()
    if isinstance(appt_time, str):
        parts = appt_time.split(":")
        appt_time = datetime.time(int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else 0)
    scheduled = datetime.datetime.combine(appt_date, appt_time)
    now = datetime.datetime.now()
    return scheduled - datetime.timedelta(minutes=JOIN_WINDOW_BEFORE_MIN) <= now <= \
        scheduled + datetime.timedelta(minutes=JOIN_WINDOW_AFTER_MIN)


def _get_or_create_session(appt):
    session = query("SELECT * FROM video_sessions WHERE appointment_id=%s", (appt["id"],), fetchone=True)
    if session:
        return session
    session_id = execute(
        """INSERT INTO video_sessions (appointment_id, patient_id, doctor_id, clinic_id)
           VALUES (%s,%s,%s,%s)""",
        (appt["id"], appt["patient_id"], appt["doctor_id"], appt["clinic_id"]),
    )
    return query("SELECT * FROM video_sessions WHERE id=%s", (session_id,), fetchone=True)


def _session_for_user(session_id):
    """Same identity check as _get_appointment_for_user, but keyed off the
    video session directly (used by join/leave/signal once a session exists)."""
    session = query("SELECT * FROM video_sessions WHERE id=%s", (session_id,), fetchone=True)
    if not session:
        return None
    if g.role == "patient" and session["patient_id"] == g.profile_id:
        return session
    if g.role == "doctor" and session["doctor_id"] == g.profile_id:
        return session
    return None


@bp.get("/appointment/<int:appointment_id>/status")
@require_auth(["patient", "doctor"])
def video_status(appointment_id):
    appt = _get_appointment_for_user(appointment_id)
    if not appt:
        return jsonify({"error": "Appointment not found or not yours"}), 404
    if appt["consultation_mode"] != "ONLINE":
        return jsonify({"error": "This appointment is not marked as an online consultation"}), 400
    if appt["status"] in ("CANCELLED", "NO_SHOW"):
        return jsonify({"error": "This appointment is no longer active"}), 400

    session = query("SELECT * FROM video_sessions WHERE appointment_id=%s", (appointment_id,), fetchone=True)
    return jsonify({
        "appointment_status": appt["status"],
        "can_join_now": _within_join_window(appt),
        "session": session,
        "scheduled_date": str(appt["appointment_date"]),
        "scheduled_time": str(appt["appointment_time"]),
    })


@bp.post("/appointment/<int:appointment_id>/join")
@require_auth(["patient", "doctor"])
def join_call(appointment_id):
    appt = _get_appointment_for_user(appointment_id)
    if not appt:
        return jsonify({"error": "Appointment not found or not yours"}), 404
    if appt["consultation_mode"] != "ONLINE":
        return jsonify({"error": "This appointment is not marked as an online consultation"}), 400
    if appt["status"] in ("CANCELLED", "NO_SHOW", "COMPLETED"):
        return jsonify({"error": f"Cannot join — appointment is {appt['status']}"}), 400
    if not _within_join_window(appt):
        return jsonify({"error": "It's not yet time for this consultation. You can join 15 minutes before the scheduled time."}), 403

    session = _get_or_create_session(appt)
    field = "patient_joined_at" if g.role == "patient" else "doctor_joined_at"
    execute(f"UPDATE video_sessions SET {field}=NOW(), status='ACTIVE', started_at=COALESCE(started_at, NOW()) WHERE id=%s", (session["id"],))
    if appt["status"] == "CONFIRMED":
        execute("UPDATE appointments SET status='IN_CONSULTATION' WHERE id=%s", (appt["id"],))

    other_role = "doctor" if g.role == "patient" else "patient"
    other_user = query(
        f"SELECT u.id FROM {other_role}s p JOIN users u ON u.id=p.user_id WHERE p.id=%s",
        (session[f"{other_role}_id"],), fetchone=True,
    )
    if other_user:
        add_notification(other_user["id"], "video_consultation", "Video consultation started",
                          "The other participant has joined the video consultation. Join now to begin.")

    add_audit(g.user_id, g.role, "VIDEO_CALL_JOINED", f"Appointment #{appointment_id}")
    session = query("SELECT * FROM video_sessions WHERE id=%s", (session["id"],), fetchone=True)
    return jsonify({"session": session, "ice_servers": ICE_SERVERS, "role": g.role})


@bp.post("/session/<int:session_id>/leave")
@require_auth(["patient", "doctor"])
def leave_call(session_id):
    session = _session_for_user(session_id)
    if not session:
        return jsonify({"error": "Session not found or not yours"}), 404

    field = "patient_left_at" if g.role == "patient" else "doctor_left_at"
    execute(f"UPDATE video_sessions SET {field}=NOW() WHERE id=%s", (session_id,))
    execute(
        "INSERT INTO video_signals (session_id, sender_role, signal_type, payload) VALUES (%s,%s,'leave','{}')",
        (session_id, g.role),
    )

    updated = query("SELECT * FROM video_sessions WHERE id=%s", (session_id,), fetchone=True)
    if updated["patient_left_at"] and updated["doctor_left_at"]:
        execute("UPDATE video_sessions SET status='ENDED', ended_at=NOW() WHERE id=%s", (session_id,))

    add_audit(g.user_id, g.role, "VIDEO_CALL_LEFT", f"Session #{session_id}")
    return jsonify({"message": "Left the call"})


@bp.post("/appointment/<int:appointment_id>/end")
@require_auth(["doctor"])
def end_call(appointment_id):
    """The doctor can explicitly end the visit for both parties (e.g. once
    the consultation is clinically complete), rather than relying on both
    sides happening to leave at the same time."""
    appt = _get_appointment_for_user(appointment_id)
    if not appt:
        return jsonify({"error": "Appointment not found or not yours"}), 404
    session = query("SELECT * FROM video_sessions WHERE appointment_id=%s", (appointment_id,), fetchone=True)
    if not session:
        return jsonify({"error": "No active session for this appointment"}), 404

    execute("UPDATE video_sessions SET status='ENDED', ended_at=NOW() WHERE id=%s", (session["id"],))
    execute(
        "INSERT INTO video_signals (session_id, sender_role, signal_type, payload) VALUES (%s,'doctor','leave','{}')",
        (session["id"],),
    )
    add_audit(g.user_id, "doctor", "VIDEO_CALL_ENDED", f"Appointment #{appointment_id}")
    return jsonify({"message": "Consultation ended"})


# ==================== Signaling relay (HTTP long-poll) ====================
@bp.post("/session/<int:session_id>/signal")
@require_auth(["patient", "doctor"])
def post_signal(session_id):
    session = _session_for_user(session_id)
    if not session:
        return jsonify({"error": "Session not found or not yours"}), 404
    if session["status"] == "ENDED":
        return jsonify({"error": "This consultation has ended"}), 400

    data = request.get_json(force=True) or {}
    signal_type = data.get("type")
    if signal_type not in ("offer", "answer", "ice-candidate"):
        return jsonify({"error": "type must be offer, answer, or ice-candidate"}), 400
    payload = data.get("payload")
    if payload is None:
        return jsonify({"error": "payload is required"}), 400

    signal_id = execute(
        "INSERT INTO video_signals (session_id, sender_role, signal_type, payload) VALUES (%s,%s,%s,%s)",
        (session_id, g.role, signal_type, json.dumps(payload)),
    )
    return jsonify({"signal_id": signal_id}), 201


@bp.get("/session/<int:session_id>/signals")
@require_auth(["patient", "doctor"])
def poll_signals(session_id):
    session = _session_for_user(session_id)
    if not session:
        return jsonify({"error": "Session not found or not yours"}), 404

    since = request.args.get("since", 0, type=int)
    # Only ever return the OTHER participant's messages — a peer never needs
    # (or should see) an echo of its own signals.
    other_role = "doctor" if g.role == "patient" else "patient"
    rows = query(
        """SELECT id, sender_role, signal_type, payload, created_at FROM video_signals
           WHERE session_id=%s AND sender_role=%s AND id > %s ORDER BY id ASC""",
        (session_id, other_role, since),
    )
    for r in rows:
        try:
            r["payload"] = json.loads(r["payload"])
        except (TypeError, ValueError):
            pass
    return jsonify(rows)
