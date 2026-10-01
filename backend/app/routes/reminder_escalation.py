import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit

bp = Blueprint("reminder_escalation", __name__, url_prefix="/api/reminder-escalation")

# How long a reminder can sit unacknowledged (MISSED) before reception is
# asked to follow up by phone. Kept generous to avoid noisy false alarms.
ESCALATE_AFTER_HOURS = 3


def _run_escalation_scan(clinic_id):
    """Lazily promote long-overdue MISSED reminders in this clinic into
    open follow-up call tasks for reception. Runs on every reception read
    instead of needing a background scheduler."""
    cutoff = datetime.datetime.now() - datetime.timedelta(hours=ESCALATE_AFTER_HOURS)
    candidates = query(
        """SELECT rl.id AS reminder_log_id, rl.patient_id, COALESCE(pi.medicine_name, m.name) AS medicine_name,
                  rl.reminder_date, rl.reminder_time
           FROM medicine_reminder_logs rl
           JOIN prescription_items pi ON pi.id = rl.prescription_item_id
           JOIN prescriptions p ON p.id = pi.prescription_id
           LEFT JOIN medicines m ON m.id = pi.medicine_id
           WHERE p.clinic_id=%s AND rl.status='MISSED' AND rl.escalated=0
                 AND TIMESTAMP(rl.reminder_date, rl.reminder_time) < %s""",
        (clinic_id, cutoff),
    )
    for c in candidates:
        execute(
            "UPDATE medicine_reminder_logs SET escalated=1, escalated_at=%s WHERE id=%s",
            (datetime.datetime.now(), c["reminder_log_id"]),
        )
        execute(
            """INSERT INTO reminder_escalation_tasks (reminder_log_id, patient_id, clinic_id, reason)
               VALUES (%s,%s,%s,%s)""",
            (c["reminder_log_id"], c["patient_id"], clinic_id,
             f"Missed {c['medicine_name']} dose on {c['reminder_date']} at {c['reminder_time']}"),
        )


@bp.get("/tasks")
@require_auth(["receptionist", "doctor"])
def list_tasks():
    _run_escalation_scan(g.clinic_id)
    rows = query(
        """SELECT ret.*, p.full_name AS patient_name, p.patient_code, p.emergency_contact,
                  u.email AS patient_email
           FROM reminder_escalation_tasks ret
           JOIN patients p ON p.id = ret.patient_id
           JOIN users u ON u.id = p.user_id
           WHERE ret.clinic_id=%s AND ret.status != 'RESOLVED'
           ORDER BY ret.created_at DESC""",
        (g.clinic_id,),
    )
    return jsonify(rows)


@bp.post("/tasks/<int:task_id>/status")
@require_auth(["receptionist", "doctor"])
def update_task(task_id):
    task = query(
        "SELECT * FROM reminder_escalation_tasks WHERE id=%s AND clinic_id=%s", (task_id, g.clinic_id), fetchone=True,
    )
    if not task:
        return jsonify({"error": "Not found"}), 404
    data = request.get_json(force=True) or {}
    new_status = data.get("status")
    if new_status not in ("CALLED", "RESOLVED"):
        return jsonify({"error": "status must be CALLED or RESOLVED"}), 400
    resolved_at = datetime.datetime.now() if new_status == "RESOLVED" else None
    execute(
        "UPDATE reminder_escalation_tasks SET status=%s, resolved_at=%s WHERE id=%s",
        (new_status, resolved_at, task_id),
    )
    add_audit(g.user_id, g.role, "REMINDER_ESCALATION_UPDATED", f"#{task_id} -> {new_status}")
    return jsonify(query("SELECT * FROM reminder_escalation_tasks WHERE id=%s", (task_id,), fetchone=True))
