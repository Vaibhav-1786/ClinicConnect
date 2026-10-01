import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit
from app.utils.permissions import require_permission
from app.routes.medicines import check_interactions, check_allergy_conflicts

bp = Blueprint("prescriptions", __name__, url_prefix="/api/prescriptions")


MAX_REMINDER_DAYS = 180  # sanity cap so a mistyped end_date can't generate years of rows


def _generate_reminder_logs(prescription_item_id, patient_id, start_date, end_date, reminder_times):
    """reminder_times: list of 'HH:MM' strings. Generates one log row per day
    in [start_date, end_date] per reminder time. Returns an error string, or
    None on success."""
    try:
        start = datetime.datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.datetime.strptime(end_date, "%Y-%m-%d").date()
    except ValueError:
        return "start_date/end_date must be in YYYY-MM-DD format"
    if end < start:
        return "end_date cannot be before start_date"
    if (end - start).days > MAX_REMINDER_DAYS:
        return f"Reminder schedule cannot exceed {MAX_REMINDER_DAYS} days"
    clean_times = []
    for t in reminder_times:
        try:
            datetime.datetime.strptime(t, "%H:%M")
            clean_times.append(t)
        except ValueError:
            return f"Invalid reminder time: {t}"
    if not clean_times:
        return "At least one reminder time is required"

    day = start
    while day <= end:
        for t in clean_times:
            execute(
                """INSERT IGNORE INTO medicine_reminder_logs
                   (prescription_item_id, patient_id, reminder_date, reminder_time, status)
                   VALUES (%s,%s,%s,%s,'PENDING')""",
                (prescription_item_id, patient_id, day, f"{t}:00"),
            )
        day += datetime.timedelta(days=1)
    return None


@bp.post("")
@require_auth(["doctor"])
@require_permission("doctor.create_prescription")
def create_prescription():
    data = request.get_json(force=True) or {}
    required = ["appointment_id", "items"]
    if any(f not in data for f in required) or not data["items"]:
        return jsonify({"error": "appointment_id and at least one medicine item are required"}), 400

    appt = query("SELECT * FROM appointments WHERE id=%s AND doctor_id=%s", (data["appointment_id"], g.profile_id), fetchone=True)
    if not appt:
        return jsonify({"error": "Appointment not found or not yours"}), 404

    # ---- Validate & normalise items (medicine_name is free text; medicine_id
    # is optional and only used for legacy clients / inventory matches). ----
    items = []
    for idx, raw in enumerate(data["items"], start=1):
        if not isinstance(raw, dict):
            return jsonify({"error": f"Medicine #{idx}: invalid item"}), 400
        name = (raw.get("medicine_name") or "").strip()
        med_id = None
        if raw.get("medicine_id"):
            try:
                med_id = int(raw["medicine_id"])
            except (TypeError, ValueError):
                return jsonify({"error": f"Medicine #{idx}: invalid medicine_id"}), 400
            med = query("SELECT id, name FROM medicines WHERE id=%s", (med_id,), fetchone=True)
            if not med:
                med_id = None
            elif not name:
                name = med["name"]  # legacy client sent only medicine_id
        if not name:
            return jsonify({"error": f"Medicine name is required (medicine #{idx})"}), 400
        if len(name) > 150:
            return jsonify({"error": f"Medicine name is too long (medicine #{idx}, max 150 characters)"}), 400
        try:
            qty = int(raw.get("quantity") or 1)
        except (TypeError, ValueError):
            return jsonify({"error": f"Medicine #{idx}: quantity must be a number"}), 400
        if qty < 1:
            return jsonify({"error": f"Medicine #{idx}: quantity must be at least 1"}), 400
        # Optional: link to an inventory medicine by exact (case-insensitive)
        # name so DB-backed safety checks can run. No match is fine.
        if med_id is None:
            matches = query("SELECT id FROM medicines WHERE LOWER(name)=LOWER(%s)", (name,))
            if len(matches) == 1:
                med_id = matches[0]["id"]
        items.append({**raw, "medicine_name": name, "medicine_id": med_id, "quantity": qty})

    # Decision-support checks. None of these block saving the prescription —
    # the doctor remains responsible for the clinical decision — they are
    # surfaced to the UI as separate, clearly labeled warning lists.
    # Interaction/allergy checks only run for medicines matched to the
    # database; free-text medicines without a match are skipped and listed
    # in `unchecked_medicines` — no result is invented for them.
    medicine_ids = [i["medicine_id"] for i in items if i["medicine_id"]]
    unchecked = [i["medicine_name"] for i in items if not i["medicine_id"]]
    warnings = check_interactions(medicine_ids)
    allergy_warnings = check_allergy_conflicts(appt["patient_id"], medicine_ids)

    duplicate_warnings = []
    seen = {}
    display = {}
    for item in items:
        key = item["medicine_name"].lower()
        seen[key] = seen.get(key, 0) + 1
        display.setdefault(key, item["medicine_name"])
    for key, count in seen.items():
        if count > 1:
            duplicate_warnings.append(f"{display[key]} appears {count} times in this prescription")

    field_warnings = []
    for item in items:
        med_name = item["medicine_name"]
        if not (item.get("dosage") or "").strip():
            field_warnings.append(f"{med_name}: dosage format looks incomplete")
        if not (item.get("frequency") or "").strip():
            field_warnings.append(f"{med_name}: frequency is missing")
        if not (item.get("duration") or "").strip():
            field_warnings.append(f"{med_name}: duration is missing")

    presc_id = execute(
        """INSERT INTO prescriptions (appointment_id, doctor_id, patient_id, clinic_id,
           diagnosis_text, notes, prescription_date)
           VALUES (%s,%s,%s,%s,%s,%s,%s)""",
        (appt["id"], g.profile_id, appt["patient_id"], appt["clinic_id"],
         data.get("diagnosis_text", ""), data.get("notes", ""), datetime.date.today()),
    )
    reminder_errors = []
    for item in items:
        item_id = execute(
            """INSERT INTO prescription_items
               (prescription_id, medicine_id, medicine_name, dosage, frequency, duration, before_after_food, quantity,
                instructions, start_date, end_date, reminder_times)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (presc_id, item["medicine_id"], item["medicine_name"], item.get("dosage"), item.get("frequency"),
             item.get("duration"), item.get("before_after_food", "after"),
             item.get("quantity", 1), item.get("instructions", ""),
             item.get("start_date"), item.get("end_date"),
             ",".join(item["reminder_times"]) if item.get("reminder_times") else None),
        )
        # Reminders only make sense if the doctor gave a full schedule; a
        # medicine item without one is still saved normally, just with no
        # patient reminders generated for it.
        if item.get("start_date") and item.get("end_date") and item.get("reminder_times"):
            err = _generate_reminder_logs(item_id, appt["patient_id"], item["start_date"], item["end_date"], item["reminder_times"])
            if err:
                reminder_errors.append(f"{item['medicine_name']}: {err}")

    if data.get("diagnosis_text"):
        execute(
            "INSERT INTO diagnoses (appointment_id, doctor_id, patient_id, diagnosis_text) VALUES (%s,%s,%s,%s)",
            (appt["id"], g.profile_id, appt["patient_id"], data["diagnosis_text"]),
        )

    if allergy_warnings or duplicate_warnings or field_warnings:
        add_audit(
            g.user_id, "doctor", "PRESCRIPTION_SAFETY_WARNING_SHOWN",
            f"#{presc_id}: allergy={len(allergy_warnings)}, duplicate={len(duplicate_warnings)}, field={len(field_warnings)}",
        )
    add_audit(g.user_id, "doctor", "PRESCRIPTION_CREATED", f"#{presc_id} for appt #{appt['id']}")
    response = {
        "prescription_id": presc_id,
        "drug_interaction_warnings": warnings,
        "allergy_warnings": allergy_warnings,
        "duplicate_medicine_warnings": duplicate_warnings,
        "field_warnings": field_warnings,
        # Manually entered medicines with no inventory match: DB-based
        # interaction/allergy checks were NOT performed for these.
        "unchecked_medicines": unchecked,
    }
    if reminder_errors:
        response["reminder_warnings"] = reminder_errors
    return jsonify(response), 201


@bp.get("/patient")
@require_auth(["patient"])
def patient_prescriptions():
    rows = query(
        """SELECT p.*, d.full_name AS doctor_name, c.name AS clinic_name
           FROM prescriptions p JOIN doctors d ON d.id=p.doctor_id JOIN clinics c ON c.id=p.clinic_id
           WHERE p.patient_id=%s ORDER BY p.prescription_date DESC""",
        (g.profile_id,),
    )
    return jsonify(rows)


@bp.get("/<int:prescription_id>")
@require_auth(["patient", "doctor", "receptionist"])
def get_prescription(prescription_id):
    presc = query(
        """SELECT p.*, d.full_name AS doctor_name, pt.full_name AS patient_name, pt.patient_code,
                  c.name AS clinic_name, c.address AS clinic_address, c.contact_number AS clinic_phone,
                  c.email AS clinic_email
           FROM prescriptions p
           JOIN doctors d ON d.id = p.doctor_id
           JOIN patients pt ON pt.id = p.patient_id
           JOIN clinics c ON c.id = p.clinic_id
           WHERE p.id=%s""",
        (prescription_id,), fetchone=True,
    )
    if not presc:
        return jsonify({"error": "Not found"}), 404
    if g.role == "patient" and presc["patient_id"] != g.profile_id:
        return jsonify({"error": "Forbidden"}), 403
    if g.role == "doctor" and presc["doctor_id"] != g.profile_id:
        return jsonify({"error": "Forbidden"}), 403

    items = query(
        """SELECT pi.*, COALESCE(pi.medicine_name, m.name) AS medicine_name, m.price
           FROM prescription_items pi LEFT JOIN medicines m ON m.id = pi.medicine_id
           WHERE pi.prescription_id=%s ORDER BY pi.id""",
        (prescription_id,),
    )
    presc["items"] = items
    return jsonify(presc)
