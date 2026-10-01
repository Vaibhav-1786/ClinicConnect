import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute

from app.utils.auth import require_auth
from app.utils.helpers import add_audit

bp = Blueprint("medicine_reminders", __name__, url_prefix="/api/patient/medicine-reminders")


def _mark_overdue_as_missed(patient_id):
    """Lazily flip PENDING reminders whose time has passed into MISSED for this
    patient. Called on every read so the buckets shown are always accurate
    without needing a background scheduler."""
    now = datetime.datetime.now()
    execute(
        """UPDATE medicine_reminder_logs
           SET status='MISSED'
           WHERE patient_id=%s AND status='PENDING'
                 AND TIMESTAMP(reminder_date, reminder_time) < %s""",
        (patient_id, now),
    )


@bp.get("")
@require_auth(["patient"])
def list_reminders():
    _mark_overdue_as_missed(g.profile_id)
    today = datetime.date.today().isoformat()

    rows = query(
        """SELECT rl.*, COALESCE(pi.medicine_name, m.name) AS medicine_name, pi.dosage, pi.instructions, pi.before_after_food,
                  p.doctor_id, d.full_name AS doctor_name
           FROM medicine_reminder_logs rl
           JOIN prescription_items pi ON pi.id = rl.prescription_item_id
           LEFT JOIN medicines m ON m.id = pi.medicine_id
           JOIN prescriptions p ON p.id = pi.prescription_id
           JOIN doctors d ON d.id = p.doctor_id
           WHERE rl.patient_id=%s
           ORDER BY rl.reminder_date, rl.reminder_time""",
        (g.profile_id,),
    )

    buckets = {"today": [], "upcoming": [], "completed": [], "missed": []}
    for r in rows:
        if r["status"] == "TAKEN":
            buckets["completed"].append(r)
        elif r["status"] == "MISSED":
            buckets["missed"].append(r)
        elif r["reminder_date"] == today:
            buckets["today"].append(r)
        elif r["reminder_date"] > today:
            buckets["upcoming"].append(r)
    return jsonify(buckets)


@bp.post("/<int:log_id>/mark")
@require_auth(["patient"])
def mark_reminder(log_id):
    log = query(
        "SELECT * FROM medicine_reminder_logs WHERE id=%s AND patient_id=%s", (log_id, g.profile_id), fetchone=True,
    )
    if not log:
        return jsonify({"error": "Reminder not found"}), 404

    data = request.get_json(force=True) or {}
    new_status = data.get("status")
    if new_status not in ("TAKEN", "SKIPPED"):
        return jsonify({"error": "status must be TAKEN or SKIPPED"}), 400

    # A patient can only log what they actually did — never re-open a reminder
    # that's already resolved, and never edit anyone else's medication record.
    if log["status"] not in ("PENDING", "MISSED"):
        return jsonify({"error": f"This reminder is already marked {log['status']}"}), 409

    execute(
        "UPDATE medicine_reminder_logs SET status=%s, taken_at=%s WHERE id=%s",
        (new_status, datetime.datetime.now() if new_status == "TAKEN" else None, log_id),
    )
    add_audit(g.user_id, "patient", "MEDICINE_REMINDER_MARKED", f"#{log_id} -> {new_status}")
    return jsonify({"status": new_status})
