import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_notification, add_audit

bp = Blueprint("bulk_notifications", __name__, url_prefix="/api/receptionist/notifications")

CATEGORIES = {"today", "tomorrow", "pending", "cancelled", "rescheduled"}

DEFAULT_MESSAGES = {
    "today": ("Appointment Today", "This is a reminder that you have an appointment with Dr. {doctor} today at {time}."),
    "tomorrow": ("Appointment Tomorrow", "This is a reminder that you have an appointment with Dr. {doctor} tomorrow, {date} at {time}."),
    "pending": ("Appointment Awaiting Confirmation", "Your appointment request with Dr. {doctor} for {date} at {time} is still pending confirmation."),
    "cancelled": ("Appointment Cancelled", "Your appointment with Dr. {doctor} on {date} at {time} has been cancelled."),
    "rescheduled": ("Appointment Rescheduled", "Your appointment with Dr. {doctor} has been rescheduled. Please check your appointments for the new date and time."),
}


@bp.get("/candidates")
@require_auth(["receptionist"])
def list_candidates():
    category = request.args.get("category")
    if category not in CATEGORIES:
        return jsonify({"error": f"category must be one of {', '.join(sorted(CATEGORIES))}"}), 400

    today = datetime.date.today()
    params = [g.clinic_id]

    if category == "today":
        sql = """SELECT a.id, a.appointment_date, a.appointment_time, a.status,
                         p.id AS patient_id, p.full_name AS patient_name, u.id AS user_id,
                         d.full_name AS doctor_name
                  FROM appointments a
                  JOIN patients p ON p.id = a.patient_id
                  JOIN users u ON u.id = p.user_id
                  JOIN doctors d ON d.id = a.doctor_id
                  WHERE a.clinic_id=%s AND a.appointment_date=CURDATE() AND a.status NOT IN ('CANCELLED','NO_SHOW')
                  ORDER BY a.appointment_time"""
    elif category == "tomorrow":
        sql = """SELECT a.id, a.appointment_date, a.appointment_time, a.status,
                         p.id AS patient_id, p.full_name AS patient_name, u.id AS user_id,
                         d.full_name AS doctor_name
                  FROM appointments a
                  JOIN patients p ON p.id = a.patient_id
                  JOIN users u ON u.id = p.user_id
                  JOIN doctors d ON d.id = a.doctor_id
                  WHERE a.clinic_id=%s AND a.appointment_date=CURDATE() + INTERVAL 1 DAY
                        AND a.status NOT IN ('CANCELLED','NO_SHOW')
                  ORDER BY a.appointment_time"""
    elif category == "pending":
        sql = """SELECT ar.id, ar.requested_date AS appointment_date, ar.requested_time AS appointment_time, ar.status,
                         p.id AS patient_id, p.full_name AS patient_name, u.id AS user_id,
                         d.full_name AS doctor_name
                  FROM appointment_requests ar
                  JOIN patients p ON p.id = ar.patient_id
                  JOIN users u ON u.id = p.user_id
                  JOIN doctors d ON d.id = ar.doctor_id
                  WHERE ar.clinic_id=%s AND ar.status IN ('PENDING','UNDER_REVIEW')
                  ORDER BY ar.requested_date"""
    elif category == "cancelled":
        sql = """SELECT a.id, a.appointment_date, a.appointment_time, a.status,
                         p.id AS patient_id, p.full_name AS patient_name, u.id AS user_id,
                         d.full_name AS doctor_name
                  FROM appointments a
                  JOIN patients p ON p.id = a.patient_id
                  JOIN users u ON u.id = p.user_id
                  JOIN doctors d ON d.id = a.doctor_id
                  WHERE a.clinic_id=%s AND a.status='CANCELLED' AND DATE(a.updated_at)=CURDATE()
                  ORDER BY a.appointment_time"""
    else:  # rescheduled
        sql = """SELECT ar.id, ar.requested_date AS appointment_date, ar.requested_time AS appointment_time, ar.status,
                         p.id AS patient_id, p.full_name AS patient_name, u.id AS user_id,
                         d.full_name AS doctor_name
                  FROM appointment_requests ar
                  JOIN patients p ON p.id = ar.patient_id
                  JOIN users u ON u.id = p.user_id
                  JOIN doctors d ON d.id = ar.doctor_id
                  WHERE ar.clinic_id=%s AND ar.status='RESCHEDULED' AND DATE(ar.updated_at)=CURDATE()
                  ORDER BY ar.requested_date"""

    rows = query(sql, params)
    return jsonify({"category": category, "candidates": rows})


@bp.post("/bulk-send")
@require_auth(["receptionist"])
def bulk_send():
    data = request.get_json(force=True) or {}
    category = data.get("category")
    ids = data.get("appointment_ids") or []
    if category not in CATEGORIES:
        return jsonify({"error": f"category must be one of {', '.join(sorted(CATEGORIES))}"}), 400
    if not ids:
        return jsonify({"error": "Select at least one recipient"}), 400

    table = "appointment_requests" if category in ("pending", "rescheduled") else "appointments"
    date_col = "requested_date" if table == "appointment_requests" else "appointment_date"
    time_col = "requested_time" if table == "appointment_requests" else "appointment_time"

    placeholders = ",".join(["%s"] * len(ids))
    rows = query(
        f"""SELECT t.id, t.{date_col} AS appt_date, t.{time_col} AS appt_time,
                   p.id AS patient_id, u.id AS user_id, d.full_name AS doctor_name
            FROM {table} t
            JOIN patients p ON p.id = t.patient_id
            JOIN users u ON u.id = p.user_id
            JOIN doctors d ON d.id = t.doctor_id
            WHERE t.id IN ({placeholders}) AND t.clinic_id=%s""",
        ids + [g.clinic_id],
    )
    if not rows:
        return jsonify({"error": "None of the selected appointments belong to your clinic"}), 400

    title_tpl, body_tpl = DEFAULT_MESSAGES[category]
    custom_message = (data.get("message") or "").strip()
    sent = 0
    for row in rows:
        body = custom_message or body_tpl.format(
            doctor=row["doctor_name"], date=str(row["appt_date"]), time=str(row["appt_time"])[:5],
        )
        add_notification(row["user_id"], f"bulk_{category}", title_tpl, body)
        sent += 1

    add_audit(g.user_id, "receptionist", "BULK_NOTIFICATION_SENT", f"{category}: {sent} recipient(s)")
    return jsonify({"sent": sent})
