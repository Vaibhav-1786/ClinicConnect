import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit

bp = Blueprint("care_checklist", __name__, url_prefix="/api/care-checklist")

DEFAULT_ITEMS = [
    ("Take all prescribed medicines exactly as directed", "medication"),
    ("Drink plenty of fluids and get adequate rest", "lifestyle"),
    ("Watch for warning signs (high fever, severe pain, breathlessness) and contact the clinic if they appear", "warning_sign"),
]


def generate_checklist_for_appointment(appointment_id, patient_id, doctor_id):
    """
    Called when an appointment is marked COMPLETED. Builds a starter
    checklist from the consultation note's follow-up field and the
    prescribed medicines, plus a few sensible generic defaults. The doctor
    or patient can still edit/complete items afterwards; nothing here is
    a medical instruction beyond what the doctor already recorded.
    """
    # Don't duplicate if it was already generated (e.g. a status webhook retry)
    existing = query(
        "SELECT COUNT(*) AS c FROM care_checklist_items WHERE appointment_id=%s",
        (appointment_id,), fetchone=True,
    )
    if existing and existing["c"] > 0:
        return

    items = []
    note = query(
        "SELECT follow_up FROM consultation_notes WHERE appointment_id=%s", (appointment_id,), fetchone=True,
    )
    if note and (note.get("follow_up") or "").strip():
        items.append((f"Follow-up: {note['follow_up'].strip()}", "follow_up"))

    prescription = query(
        "SELECT id FROM prescriptions WHERE appointment_id=%s", (appointment_id,), fetchone=True,
    )
    if prescription:
        rx_items = query(
            """SELECT COALESCE(pi.medicine_name, m.name) AS name, pi.duration FROM prescription_items pi
               LEFT JOIN medicines m ON m.id = pi.medicine_id WHERE pi.prescription_id=%s""",
            (prescription["id"],),
        )
        for it in rx_items:
            duration = f" for {it['duration']}" if it.get("duration") else ""
            items.append((f"Complete your course of {it['name']}{duration}", "medication"))

    items.extend(DEFAULT_ITEMS)

    for text, category in items:
        execute(
            """INSERT INTO care_checklist_items (appointment_id, patient_id, doctor_id, item_text, category)
               VALUES (%s,%s,%s,%s,%s)""",
            (appointment_id, patient_id, doctor_id, text, category),
        )


@bp.get("/mine")
@require_auth(["patient"])
def my_checklist():
    rows = query(
        """SELECT cci.*, a.appointment_date, d.full_name AS doctor_name
           FROM care_checklist_items cci
           JOIN appointments a ON a.id = cci.appointment_id
           JOIN doctors d ON d.id = cci.doctor_id
           WHERE cci.patient_id=%s
           ORDER BY cci.is_done ASC, a.appointment_date DESC, cci.id DESC""",
        (g.profile_id,),
    )
    return jsonify(rows)


@bp.patch("/<int:item_id>/toggle")
@require_auth(["patient"])
def toggle_item(item_id):
    item = query(
        "SELECT * FROM care_checklist_items WHERE id=%s AND patient_id=%s", (item_id, g.profile_id), fetchone=True,
    )
    if not item:
        return jsonify({"error": "Not found"}), 404
    new_done = 0 if item["is_done"] else 1
    execute(
        "UPDATE care_checklist_items SET is_done=%s, done_at=%s WHERE id=%s",
        (new_done, datetime.datetime.utcnow() if new_done else None, item_id),
    )
    return jsonify({"id": item_id, "is_done": bool(new_done)})


@bp.get("/appointment/<int:appointment_id>")
@require_auth(["doctor"])
def checklist_for_appointment(appointment_id):
    appt = query(
        "SELECT * FROM appointments WHERE id=%s AND doctor_id=%s", (appointment_id, g.profile_id), fetchone=True,
    )
    if not appt:
        return jsonify({"error": "Not found"}), 404
    return jsonify(query(
        "SELECT * FROM care_checklist_items WHERE appointment_id=%s ORDER BY id", (appointment_id,),
    ))


@bp.post("/appointment/<int:appointment_id>/items")
@require_auth(["doctor"])
def add_item(appointment_id):
    appt = query(
        "SELECT * FROM appointments WHERE id=%s AND doctor_id=%s", (appointment_id, g.profile_id), fetchone=True,
    )
    if not appt:
        return jsonify({"error": "Not found"}), 404
    data = request.get_json(force=True) or {}
    text = (data.get("item_text") or "").strip()
    if not text:
        return jsonify({"error": "item_text is required"}), 400
    category = data.get("category", "other")
    item_id = execute(
        """INSERT INTO care_checklist_items (appointment_id, patient_id, doctor_id, item_text, category)
           VALUES (%s,%s,%s,%s,%s)""",
        (appointment_id, appt["patient_id"], g.profile_id, text, category),
    )
    add_audit(g.user_id, "doctor", "CARE_CHECKLIST_ITEM_ADDED", f"Appt #{appointment_id}")
    return jsonify(query("SELECT * FROM care_checklist_items WHERE id=%s", (item_id,), fetchone=True)), 201
