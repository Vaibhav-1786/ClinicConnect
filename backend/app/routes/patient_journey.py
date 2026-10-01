"""
Patient Journey Timeline (spec section 3).

Stitches together data that already lives across many existing tables
(appointments, opd_queue, vitals, patient_triage, consultation_notes,
prescriptions, lab_orders, invoices, followups) into one ordered view of
a single visit, from Registration through Follow-up. Nothing new is
stored here — this endpoint is a read-only aggregation layer, so all the
underlying write paths (check-in, vitals, prescriptions, billing, etc.)
keep working exactly as before.

Access is role-based: patients may only fetch their own journey; doctors
and receptionists may fetch a journey for a patient in an appointment
they are attached to; admins may fetch any.
"""
from flask import Blueprint, request, jsonify, g

from app.utils.db import query
from app.utils.auth import require_auth

bp = Blueprint("patient_journey", __name__, url_prefix="/api/patient-journey")

STEP_ORDER = [
    "registration", "appointment", "check_in", "queue", "vitals",
    "consultation", "prescription", "laboratory", "billing", "follow_up",
]


def _step(key, label, status, timestamp=None, staff=None, detail=None, actions=None):
    return {
        "key": key, "label": label, "status": status,  # 'completed' | 'current' | 'upcoming'
        "timestamp": timestamp, "staff": staff, "detail": detail, "actions": actions or [],
    }


def _build_journey(appointment_id):
    appt = query(
        """SELECT a.*, p.full_name AS patient_name, p.patient_code, p.created_at AS patient_registered_at,
                  d.full_name AS doctor_name, c.name AS clinic_name
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           JOIN doctors d ON d.id = a.doctor_id
           JOIN clinics c ON c.id = a.clinic_id
           WHERE a.id=%s""",
        (appointment_id,), fetchone=True,
    )
    if not appt:
        return None

    steps = []

    # 1. Registration — the patient account itself (not per-visit).
    steps.append(_step(
        "registration", "Registration", "completed",
        timestamp=appt["patient_registered_at"], detail=f"{appt['patient_name']} ({appt['patient_code']})",
    ))

    # 2. Appointment — always completed if we got this far (it exists).
    cancelled = appt["status"] in ("CANCELLED", "NO_SHOW")
    steps.append(_step(
        "appointment", "Appointment", "completed" if not cancelled else "cancelled",
        timestamp=f"{appt['appointment_date']} {appt['appointment_time']}",
        staff=appt["doctor_name"], detail=f"{appt['clinic_name']}",
    ))
    if cancelled:
        for key in STEP_ORDER[2:]:
            steps.append(_step(key, key.replace("_", " ").title(), "cancelled"))
        return {"appointment": appt, "steps": steps}

    # 3 & 4. Check-in / Queue — from opd_queue, if a walk-in/check-in row exists.
    queue_row = query(
        "SELECT * FROM opd_queue WHERE appointment_id=%s ORDER BY id DESC LIMIT 1",
        (appointment_id,), fetchone=True,
    )
    appt_checked_in = appt["status"] in ("CHECKED_IN", "IN_CONSULTATION", "COMPLETED")
    if queue_row or appt_checked_in:
        steps.append(_step(
            "check_in", "Check-in", "completed",
            timestamp=queue_row["check_in_time"] if queue_row else None,
        ))
    else:
        steps.append(_step("check_in", "Check-in", "upcoming"))

    if queue_row:
        queue_status_map = {
            "Waiting": "current", "Called": "current", "In Consultation": "completed",
            "Completed": "completed", "Cancelled": "cancelled", "No Show": "cancelled", "Skipped": "current",
        }
        steps.append(_step(
            "queue", "Queue", queue_status_map.get(queue_row["status"], "current"),
            detail=f"Token #{queue_row['token_number']} — {queue_row['status']}"
                   + (f" ({queue_row['priority']})" if queue_row.get("priority") and queue_row["priority"] != "normal" else ""),
        ))
    elif appt_checked_in:
        steps.append(_step("queue", "Queue", "completed", detail="No walk-in token — direct appointment"))
    else:
        steps.append(_step("queue", "Queue", "upcoming"))

    # 5. Vitals
    vitals = query(
        "SELECT * FROM vitals WHERE appointment_id=%s ORDER BY id DESC LIMIT 1",
        (appointment_id,), fetchone=True,
    )
    triage = query(
        "SELECT * FROM patient_triage WHERE appointment_id=%s ORDER BY id DESC LIMIT 1",
        (appointment_id,), fetchone=True,
    )
    if vitals:
        steps.append(_step(
            "vitals", "Vitals", "completed", timestamp=vitals["recorded_at"],
            detail=f"BP {vitals['blood_pressure'] or '—'}, Pulse {vitals['pulse'] or '—'}, SpO2 {vitals['spo2'] or '—'}",
        ))
    elif triage:
        steps.append(_step(
            "vitals", "Vitals", "current", timestamp=triage["created_at"],
            detail=f"Triage recorded — {triage['category']}",
        ))
    else:
        steps.append(_step(
            "vitals", "Vitals",
            "current" if appt["status"] in ("CHECKED_IN", "IN_CONSULTATION") else "upcoming",
        ))

    # 6. Consultation
    note = query(
        "SELECT * FROM consultation_notes WHERE appointment_id=%s", (appointment_id,), fetchone=True,
    )
    if note:
        steps.append(_step(
            "consultation", "Consultation", "completed", timestamp=note["updated_at"],
            staff=appt["doctor_name"], detail=note["chief_complaint"] or None,
        ))
    else:
        steps.append(_step(
            "consultation", "Consultation",
            "current" if appt["status"] == "IN_CONSULTATION" else "upcoming",
        ))

    # 7. Prescription
    presc = query(
        "SELECT * FROM prescriptions WHERE appointment_id=%s ORDER BY id DESC LIMIT 1",
        (appointment_id,), fetchone=True,
    )
    if presc:
        steps.append(_step("prescription", "Prescription", "completed", timestamp=presc["prescription_date"], staff=appt["doctor_name"]))
    else:
        steps.append(_step("prescription", "Prescription", "upcoming"))

    # 8. Laboratory (optional — many visits have no lab orders at all)
    lab_orders = query(
        """SELECT lo.*, lt.name AS test_name FROM lab_orders lo
           JOIN lab_tests lt ON lt.id = lo.lab_test_id
           WHERE lo.appointment_id=%s""",
        (appointment_id,),
    )
    if lab_orders:
        all_done = all(o["status"] == "completed" for o in lab_orders)
        steps.append(_step(
            "laboratory", "Laboratory", "completed" if all_done else "current",
            detail=", ".join(f"{o['test_name']} ({o['status']})" for o in lab_orders),
        ))
    else:
        steps.append(_step("laboratory", "Laboratory", "not_applicable", detail="No lab tests ordered for this visit"))

    # 9. Billing
    invoice = query(
        "SELECT * FROM invoices WHERE appointment_id=%s ORDER BY id DESC LIMIT 1",
        (appointment_id,), fetchone=True,
    )
    if invoice:
        steps.append(_step(
            "billing", "Billing", "completed" if invoice["payment_status"] == "Paid" else "current",
            timestamp=invoice["created_at"],
            detail=f"{invoice['invoice_number']} — {invoice['payment_status']} — ₹{invoice['total_amount']}",
        ))
    else:
        steps.append(_step("billing", "Billing", "upcoming" if presc else "not_applicable"))

    # 10. Follow-up
    followup = query(
        "SELECT * FROM followups WHERE appointment_id=%s ORDER BY id DESC LIMIT 1",
        (appointment_id,), fetchone=True,
    )
    if followup:
        status = "completed" if followup["status"] == "completed" else "current"
        steps.append(_step("follow_up", "Follow-up", status, timestamp=followup["followup_date"], detail=followup["reason"]))
    else:
        steps.append(_step("follow_up", "Follow-up", "not_applicable"))

    return {"appointment": appt, "steps": steps}


@bp.get("/<int:appointment_id>")
@require_auth(["patient", "doctor", "receptionist", "admin"])
def get_journey(appointment_id):
    result = _build_journey(appointment_id)
    if not result:
        return jsonify({"error": "Appointment not found"}), 404
    appt = result["appointment"]

    if g.role == "patient" and appt["patient_id"] != g.profile_id:
        return jsonify({"error": "Forbidden"}), 403
    if g.role == "doctor" and appt["doctor_id"] != g.profile_id:
        return jsonify({"error": "Forbidden"}), 403
    if g.role == "receptionist" and appt["clinic_id"] != g.clinic_id:
        return jsonify({"error": "Forbidden"}), 403

    return jsonify({
        "appointment_id": appointment_id,
        "patient_name": appt["patient_name"],
        "patient_code": appt["patient_code"],
        "doctor_name": appt["doctor_name"],
        "clinic_name": appt["clinic_name"],
        "steps": result["steps"],
    })


@bp.get("/patient/latest")
@require_auth(["patient"])
def get_my_latest_journey():
    """Convenience endpoint for the patient dashboard: journey for the
    patient's most relevant appointment (in-progress today, else the most
    recently booked one)."""
    appt = query(
        """SELECT id FROM appointments WHERE patient_id=%s
           AND status IN ('CONFIRMED','CHECKED_IN','IN_CONSULTATION')
           ORDER BY appointment_date DESC, appointment_time DESC LIMIT 1""",
        (g.profile_id,), fetchone=True,
    )
    if not appt:
        appt = query(
            "SELECT id FROM appointments WHERE patient_id=%s ORDER BY appointment_date DESC, appointment_time DESC LIMIT 1",
            (g.profile_id,), fetchone=True,
        )
    if not appt:
        return jsonify({"steps": [], "message": "No appointments yet"})
    result = _build_journey(appt["id"])
    appt_full = result["appointment"]
    return jsonify({
        "appointment_id": appt["id"],
        "patient_name": appt_full["patient_name"],
        "doctor_name": appt_full["doctor_name"],
        "clinic_name": appt_full["clinic_name"],
        "steps": result["steps"],
    })
