import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute, get_conn
from app.utils.auth import require_auth
from app.utils.helpers import add_audit, add_notification
from app.services.slots import generate_slots

bp = Blueprint("waitlist", __name__)


def _check_family_member(patient_id, family_member_id):
    if not family_member_id:
        return True
    return bool(query(
        "SELECT id FROM family_members WHERE id=%s AND patient_id=%s AND is_active=1",
        (family_member_id, patient_id), fetchone=True,
    ))


# =================== Patient ===================
@bp.post("/api/patient/waitlist")
@require_auth(["patient"])
def join_waitlist():
    data = request.get_json(force=True) or {}
    required = ["doctor_id", "clinic_id", "preferred_date", "preferred_time_start", "preferred_time_end"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    if not query("SELECT id FROM clinic_doctors WHERE clinic_id=%s AND doctor_id=%s",
                 (data["clinic_id"], data["doctor_id"]), fetchone=True):
        return jsonify({"error": "Doctor is not associated with this clinic"}), 400
    if not _check_family_member(g.profile_id, data.get("family_member_id")):
        return jsonify({"error": "Family member not found"}), 400

    try:
        pref_date = datetime.datetime.strptime(data["preferred_date"], "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"error": "preferred_date must be YYYY-MM-DD"}), 400
    if pref_date < datetime.date.today():
        return jsonify({"error": "Preferred date cannot be in the past"}), 400
    if data["preferred_time_start"] >= data["preferred_time_end"]:
        return jsonify({"error": "preferred_time_start must be before preferred_time_end"}), 400

    existing = query(
        """SELECT id FROM appointment_waitlist WHERE patient_id=%s AND doctor_id=%s AND clinic_id=%s
           AND preferred_date=%s AND status IN ('WAITING','NOTIFIED')""",
        (g.profile_id, data["doctor_id"], data["clinic_id"], pref_date), fetchone=True,
    )
    if existing:
        return jsonify({"error": "You are already on the waitlist for this doctor on this date"}), 409

    entry_id = execute(
        """INSERT INTO appointment_waitlist
           (patient_id, family_member_id, doctor_id, clinic_id, preferred_date,
            preferred_time_start, preferred_time_end, appointment_type, reason, status)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'WAITING')""",
        (g.profile_id, data.get("family_member_id"), data["doctor_id"], data["clinic_id"], pref_date,
         data["preferred_time_start"], data["preferred_time_end"],
         data.get("appointment_type", "General"), data.get("reason", "")),
    )
    add_audit(g.user_id, "patient", "WAITLIST_JOINED", f"Waitlist #{entry_id}")
    return jsonify({"waitlist_id": entry_id, "status": "WAITING"}), 201


@bp.get("/api/patient/waitlist")
@require_auth(["patient"])
def list_my_waitlist():
    entries = query(
        """SELECT w.*, d.full_name AS doctor_name, c.name AS clinic_name, fm.full_name AS family_member_name
           FROM appointment_waitlist w
           JOIN doctors d ON d.id = w.doctor_id
           JOIN clinics c ON c.id = w.clinic_id
           LEFT JOIN family_members fm ON fm.id = w.family_member_id
           WHERE w.patient_id=%s ORDER BY w.created_at DESC""",
        (g.profile_id,),
    )
    return jsonify(entries)


@bp.post("/api/patient/waitlist/<int:entry_id>/cancel")
@require_auth(["patient"])
def cancel_waitlist_entry(entry_id):
    entry = query("SELECT * FROM appointment_waitlist WHERE id=%s AND patient_id=%s", (entry_id, g.profile_id), fetchone=True)
    if not entry:
        return jsonify({"error": "Waitlist entry not found"}), 404
    if entry["status"] not in ("WAITING", "NOTIFIED"):
        return jsonify({"error": f"Cannot cancel an entry in status {entry['status']}"}), 409
    execute("UPDATE appointment_waitlist SET status='CANCELLED' WHERE id=%s", (entry_id,))
    add_audit(g.user_id, "patient", "WAITLIST_CANCELLED", f"Waitlist #{entry_id}")
    return jsonify({"status": "CANCELLED"})


@bp.post("/api/patient/waitlist/<int:entry_id>/claim")
@require_auth(["patient"])
def claim_waitlist_slot(entry_id):
    """Patient claims a slot that opened up after being NOTIFIED. Re-checks the
    slot is genuinely still free (race-safe) before creating the appointment."""
    entry = query("SELECT * FROM appointment_waitlist WHERE id=%s AND patient_id=%s", (entry_id, g.profile_id), fetchone=True)
    if not entry:
        return jsonify({"error": "Waitlist entry not found"}), 404
    if entry["status"] != "NOTIFIED":
        return jsonify({"error": "This waitlist entry has no available slot to claim right now"}), 409

    slots = generate_slots(entry["doctor_id"], entry["clinic_id"], str(entry["preferred_date"]))
    candidates = [
        s for s in slots
        if s["available"] and str(entry["preferred_time_start"])[:5] <= s["time"] <= str(entry["preferred_time_end"])[:5]
    ]
    if not candidates:
        execute("UPDATE appointment_waitlist SET status='WAITING' WHERE id=%s", (entry_id,))
        return jsonify({"error": "That slot was just taken. You remain on the waitlist for the next opening."}), 409

    chosen_time = f"{candidates[0]['time']}:00"
    conn = get_conn()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """SELECT id FROM appointments WHERE doctor_id=%s AND appointment_date=%s AND appointment_time=%s
               AND status NOT IN ('CANCELLED','NO_SHOW') FOR UPDATE""",
            (entry["doctor_id"], entry["preferred_date"], chosen_time),
        )
        if cur.fetchone():
            conn.rollback()
            return jsonify({"error": "That slot was just taken. You remain on the waitlist for the next opening."}), 409

        cur.execute(
            """INSERT INTO appointments (patient_id, family_member_id, doctor_id, clinic_id,
               appointment_date, appointment_time, status, reason)
               VALUES (%s,%s,%s,%s,%s,%s,'CONFIRMED',%s)""",
            (entry["patient_id"], entry["family_member_id"], entry["doctor_id"], entry["clinic_id"],
             entry["preferred_date"], chosen_time, entry.get("reason") or "Claimed from waitlist"),
        )
        appt_id = cur.lastrowid
        cur.execute("UPDATE appointment_waitlist SET status='BOOKED' WHERE id=%s", (entry_id,))
        conn.commit()
        cur.close()
    finally:
        conn.close()

    add_audit(g.user_id, "patient", "WAITLIST_CLAIMED", f"Waitlist #{entry_id} -> Appt #{appt_id}")
    return jsonify({"appointment_id": appt_id, "status": "BOOKED"})


# =================== Receptionist ===================
@bp.get("/api/receptionist/waitlist")
@require_auth(["receptionist"])
def receptionist_list_waitlist():
    status = request.args.get("status")
    sql = """SELECT w.*, p.full_name AS patient_name, p.patient_code, d.full_name AS doctor_name,
                     fm.full_name AS family_member_name
              FROM appointment_waitlist w
              JOIN patients p ON p.id = w.patient_id
              JOIN doctors d ON d.id = w.doctor_id
              LEFT JOIN family_members fm ON fm.id = w.family_member_id
              WHERE w.clinic_id=%s"""
    params = [g.clinic_id]
    if status:
        sql += " AND w.status=%s"; params.append(status)
    sql += " ORDER BY w.created_at DESC"
    return jsonify(query(sql, params))


@bp.post("/api/receptionist/waitlist/<int:entry_id>/notify")
@require_auth(["receptionist"])
def receptionist_notify_entry(entry_id):
    entry = query("SELECT * FROM appointment_waitlist WHERE id=%s", (entry_id,), fetchone=True)
    if not entry or entry["clinic_id"] != g.clinic_id:
        return jsonify({"error": "Waitlist entry not found"}), 404
    if entry["status"] != "WAITING":
        return jsonify({"error": f"Cannot notify an entry in status {entry['status']}"}), 409
    _notify_waitlist_entry(entry)
    add_audit(g.user_id, "receptionist", "WAITLIST_NOTIFIED_MANUAL", f"Waitlist #{entry_id}")
    return jsonify({"status": "NOTIFIED"})


# =================== Admin monitor (read-only) ===================
@bp.get("/api/admin/waitlist")
@require_auth(["admin"])
def admin_monitor_waitlist():
    summary = query(
        """SELECT c.id AS clinic_id, c.name AS clinic_name, w.status, COUNT(*) AS total
           FROM appointment_waitlist w JOIN clinics c ON c.id = w.clinic_id
           GROUP BY c.id, c.name, w.status ORDER BY c.name""",
    )
    recent = query(
        """SELECT w.*, p.full_name AS patient_name, d.full_name AS doctor_name, c.name AS clinic_name
           FROM appointment_waitlist w
           JOIN patients p ON p.id = w.patient_id
           JOIN doctors d ON d.id = w.doctor_id
           JOIN clinics c ON c.id = w.clinic_id
           ORDER BY w.created_at DESC LIMIT 100""",
    )
    return jsonify({"summary": summary, "recent": recent})


# =================== Shared helper: called from appointments.py ===================
def _notify_waitlist_entry(entry):
    patient_user = query(
        "SELECT u.id FROM patients p JOIN users u ON u.id=p.user_id WHERE p.id=%s",
        (entry["patient_id"],), fetchone=True,
    )
    doctor = query("SELECT full_name FROM doctors WHERE id=%s", (entry["doctor_id"],), fetchone=True)
    execute("UPDATE appointment_waitlist SET status='NOTIFIED', notified_at=NOW() WHERE id=%s", (entry["id"],))
    if patient_user:
        add_notification(
            patient_user["id"], "waitlist_availability", "A Slot Opened Up!",
            f"A slot with Dr. {doctor['full_name']} on {entry['preferred_date']} is now available. "
            f"Open your Waitlist page to claim it before someone else does.",
        )


def check_waitlist_on_cancellation(doctor_id, clinic_id, appointment_date, appointment_time):
    """Find WAITING patients whose preferred window covers the freed slot and notify them.
    Called after an appointment/request is cancelled or marked no-show."""
    time_str = str(appointment_time)[:5]
    matches = query(
        """SELECT * FROM appointment_waitlist
           WHERE doctor_id=%s AND clinic_id=%s AND preferred_date=%s AND status='WAITING'
                 AND %s BETWEEN preferred_time_start AND preferred_time_end
           ORDER BY created_at ASC LIMIT 1""",
        (doctor_id, clinic_id, appointment_date, f"{time_str}:00"),
    )
    for entry in matches:
        _notify_waitlist_entry(entry)
