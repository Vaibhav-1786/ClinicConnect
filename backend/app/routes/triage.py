"""
Digital Triage (spec section 6).

A structured pre-consultation record captured by receptionist/nurse
staff. The computed "category" (normal / priority / urgent) is a
workflow/decision-support indicator ONLY — never framed to the user as
a diagnosis — and authorized staff can always override it. Every
classification and override is kept in the row itself (updated_by /
updated_at) which, combined with the append-only audit_logs, gives a
full triage history.
"""
from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit
from app.utils.permissions import require_permission

bp = Blueprint("triage", __name__, url_prefix="/api/triage")


def _auto_classify(data):
    """Simple, transparent rule-based suggestion — not a diagnosis.
    Any single red-flag vital pushes to 'urgent'; a couple of borderline
    values push to 'priority'; otherwise 'normal'. Staff can always
    override the result."""
    reasons = []
    urgent = False
    priority = False

    if data.get("emergency_indicator"):
        urgent = True
        reasons.append("Emergency indicator flagged")

    temp = data.get("temperature_f")
    if temp is not None:
        try:
            temp = float(temp)
            if temp >= 103:
                urgent = True; reasons.append("High fever (>=103°F)")
            elif temp >= 100.4:
                priority = True; reasons.append("Fever (>=100.4°F)")
        except (TypeError, ValueError):
            pass

    spo2 = data.get("spo2")
    if spo2 is not None:
        try:
            spo2 = int(spo2)
            if spo2 < 90:
                urgent = True; reasons.append("Low SpO2 (<90%)")
            elif spo2 < 95:
                priority = True; reasons.append("Borderline SpO2 (<95%)")
        except (TypeError, ValueError):
            pass

    pulse = data.get("pulse")
    if pulse is not None:
        try:
            pulse = int(pulse)
            if pulse > 130 or pulse < 40:
                urgent = True; reasons.append("Abnormal pulse")
            elif pulse > 110 or pulse < 50:
                priority = True; reasons.append("Borderline pulse")
        except (TypeError, ValueError):
            pass

    pain = data.get("pain_level")
    if pain is not None:
        try:
            pain = int(pain)
            if pain >= 8:
                priority = True; reasons.append("High pain level")
        except (TypeError, ValueError):
            pass

    bp_reading = (data.get("blood_pressure") or "").strip()
    if bp_reading and "/" in bp_reading:
        try:
            systolic, diastolic = bp_reading.split("/")
            systolic, diastolic = int(systolic), int(diastolic)
            if systolic >= 180 or diastolic >= 120:
                urgent = True; reasons.append("Hypertensive crisis range BP")
            elif systolic >= 160 or diastolic >= 100:
                priority = True; reasons.append("Elevated BP")
        except ValueError:
            pass

    category = "urgent" if urgent else ("priority" if priority else "normal")
    return category, "; ".join(reasons) if reasons else None


@bp.post("")
@require_auth(["receptionist", "doctor"])
@require_permission("receptionist.record_triage")
def create_triage():
    data = request.get_json(force=True) or {}
    appointment_id = data.get("appointment_id")
    queue_id = data.get("queue_id")
    if not appointment_id and not queue_id:
        return jsonify({"error": "appointment_id or queue_id is required"}), 400

    patient_id = clinic_id = None
    if appointment_id:
        appt = query("SELECT * FROM appointments WHERE id=%s", (appointment_id,), fetchone=True)
        if not appt:
            return jsonify({"error": "Appointment not found"}), 404
        patient_id, clinic_id = appt["patient_id"], appt["clinic_id"]
    else:
        entry = query("SELECT * FROM opd_queue WHERE id=%s", (queue_id,), fetchone=True)
        if not entry:
            return jsonify({"error": "Queue entry not found"}), 404
        if not entry.get("patient_id"):
            return jsonify({"error": "Triage requires a registered patient (not an unregistered walk-in name)"}), 400
        patient_id, clinic_id = entry["patient_id"], entry["clinic_id"]
        appointment_id = entry.get("appointment_id")

    if g.role == "receptionist" and clinic_id != g.clinic_id:
        return jsonify({"error": "Forbidden"}), 403

    category, reason = _auto_classify(data)

    triage_id = execute(
        """INSERT INTO patient_triage
           (appointment_id, queue_id, patient_id, clinic_id, recorded_by_user_id, recorded_by_role,
            chief_complaint, symptoms, temperature_f, blood_pressure, pulse, spo2,
            weight_kg, height_cm, pain_level, emergency_indicator, category, category_reason, notes)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (appointment_id, queue_id, patient_id, clinic_id, g.user_id, g.role,
         data.get("chief_complaint"), data.get("symptoms"), data.get("temperature_f"),
         data.get("blood_pressure"), data.get("pulse"), data.get("spo2"),
         data.get("weight_kg"), data.get("height_cm"), data.get("pain_level"),
         1 if data.get("emergency_indicator") else 0, category, reason, data.get("notes")),
    )
    # Reflect the triage priority onto the live queue token, if one exists,
    # so reception/doctor queue views immediately show it.
    if queue_id:
        execute("UPDATE opd_queue SET priority=%s WHERE id=%s", (category, queue_id))
    elif appointment_id:
        execute("UPDATE opd_queue SET priority=%s WHERE appointment_id=%s", (category, appointment_id))
    add_audit(g.user_id, g.role, "TRIAGE_RECORDED", f"Patient #{patient_id} classified {category}")
    return jsonify({"id": triage_id, "category": category, "category_reason": reason}), 201


@bp.get("/appointment/<int:appointment_id>")
@require_auth(["receptionist", "doctor", "admin"])
def get_triage_by_appointment(appointment_id):
    rows = query(
        "SELECT * FROM patient_triage WHERE appointment_id=%s ORDER BY id DESC", (appointment_id,),
    )
    return jsonify(rows)


@bp.get("/queue/<int:queue_id>")
@require_auth(["receptionist", "doctor", "admin"])
def get_triage_by_queue(queue_id):
    rows = query(
        "SELECT * FROM patient_triage WHERE queue_id=%s ORDER BY id DESC", (queue_id,),
    )
    return jsonify(rows)


@bp.put("/<int:triage_id>/classification")
@require_auth(["receptionist", "doctor"])
@require_permission("triage.override_classification")
def override_classification(triage_id):
    """Authorized staff can override the suggested category. Kept as a
    normal UPDATE (not append-only) but every change is audit-logged, and
    the row itself keeps updated_by/updated_at, so a reviewer can always
    see who changed the classification and when."""
    data = request.get_json(force=True) or {}
    category = data.get("category")
    if category not in ("normal", "priority", "urgent"):
        return jsonify({"error": "category must be one of normal, priority, urgent"}), 400

    triage = query("SELECT * FROM patient_triage WHERE id=%s", (triage_id,), fetchone=True)
    if not triage:
        return jsonify({"error": "Triage record not found"}), 404

    execute(
        """UPDATE patient_triage SET category=%s, category_reason=%s,
           updated_by_user_id=%s, updated_at=NOW() WHERE id=%s""",
        (category, data.get("reason", "Manually overridden by staff"), g.user_id, triage_id),
    )
    if triage.get("queue_id"):
        execute("UPDATE opd_queue SET priority=%s WHERE id=%s", (category, triage["queue_id"]))
    elif triage.get("appointment_id"):
        execute("UPDATE opd_queue SET priority=%s WHERE appointment_id=%s", (category, triage["appointment_id"]))
    add_audit(
        g.user_id, g.role, "TRIAGE_CLASSIFICATION_OVERRIDDEN",
        f"Triage #{triage_id}: {triage['category']} -> {category}",
    )
    return jsonify({"message": "Classification updated", "category": category})
