import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit, add_notification
from app.services.slots import generate_slots

bp = Blueprint("recurring", __name__, url_prefix="/api/patient/recurring-appointments")

VALID_FREQUENCIES = {"WEEKLY": 7, "BIWEEKLY": 14, "MONTHLY": None}  # MONTHLY handled by month-add
MAX_OCCURRENCES = 52


def _next_date(current, frequency):
    if frequency == "MONTHLY":
        month = current.month + 1
        year = current.year + (1 if month > 12 else 0)
        month = 1 if month > 12 else month
        day = min(current.day, 28)  # keep it simple/safe across month lengths
        return datetime.date(year, month, day)
    return current + datetime.timedelta(days=VALID_FREQUENCIES[frequency])


def _generate_dates(start_date, frequency, count):
    dates = [start_date]
    current = start_date
    while len(dates) < count:
        current = _next_date(current, frequency)
        dates.append(current)
    return dates


def _validate_input(data):
    errors = []
    if data.get("frequency") not in VALID_FREQUENCIES:
        errors.append("Frequency must be WEEKLY, BIWEEKLY, or MONTHLY")
    if not data.get("doctor_id") or not data.get("clinic_id"):
        errors.append("doctor_id and clinic_id are required")
    if not data.get("preferred_time"):
        errors.append("preferred_time is required")
    try:
        start = datetime.datetime.strptime(data.get("start_date", ""), "%Y-%m-%d").date()
        if start < datetime.date.today():
            errors.append("Start date cannot be in the past")
    except ValueError:
        errors.append("start_date must be in YYYY-MM-DD format")
    occ = data.get("occurrence_count")
    if not isinstance(occ, int) or not (1 <= occ <= MAX_OCCURRENCES):
        errors.append(f"occurrence_count must be an integer between 1 and {MAX_OCCURRENCES}")
    return errors


def _check_family_member(patient_id, family_member_id):
    if not family_member_id:
        return True
    return bool(query(
        "SELECT id FROM family_members WHERE id=%s AND patient_id=%s AND is_active=1",
        (family_member_id, patient_id), fetchone=True,
    ))


def _check_link(clinic_id, doctor_id):
    return bool(query(
        "SELECT id FROM clinic_doctors WHERE clinic_id=%s AND doctor_id=%s",
        (clinic_id, doctor_id), fetchone=True,
    ))


# ---------------- Preview: which of the generated dates are actually bookable ----------------
@bp.post("/preview")
@require_auth(["patient"])
def preview_schedule():
    data = request.get_json(force=True) or {}
    errors = _validate_input(data)
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400
    if not _check_link(data["clinic_id"], data["doctor_id"]):
        return jsonify({"error": "Doctor is not associated with this clinic"}), 400
    if not _check_family_member(g.profile_id, data.get("family_member_id")):
        return jsonify({"error": "Family member not found"}), 400

    start = datetime.datetime.strptime(data["start_date"], "%Y-%m-%d").date()
    dates = _generate_dates(start, data["frequency"], data["occurrence_count"])
    preferred_time = data["preferred_time"]  # "HH:MM"

    preview = []
    for d in dates:
        slots = generate_slots(data["doctor_id"], data["clinic_id"], d.isoformat())
        slot = next((s for s in slots if s["time"] == preferred_time), None)
        preview.append({
            "date": d.isoformat(),
            "time": preferred_time,
            "available": bool(slot and slot["available"]),
            "reason": None if slots else "Doctor unavailable on this day",
        })
    return jsonify({"preview": preview})


# ---------------- Confirm: create the plan + generate individual requests ----------------
@bp.post("")
@require_auth(["patient"])
def create_plan():
    data = request.get_json(force=True) or {}
    errors = _validate_input(data)
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400
    if not _check_link(data["clinic_id"], data["doctor_id"]):
        return jsonify({"error": "Doctor is not associated with this clinic"}), 400
    if not _check_family_member(g.profile_id, data.get("family_member_id")):
        return jsonify({"error": "Family member not found"}), 400

    start = datetime.datetime.strptime(data["start_date"], "%Y-%m-%d").date()
    dates = _generate_dates(start, data["frequency"], data["occurrence_count"])
    preferred_time = data["preferred_time"]

    plan_id = execute(
        """INSERT INTO recurring_appointment_plans
           (patient_id, family_member_id, doctor_id, clinic_id, frequency, preferred_time,
            reason, start_date, occurrence_count, status)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'ACTIVE')""",
        (g.profile_id, data.get("family_member_id"), data["doctor_id"], data["clinic_id"],
         data["frequency"], f"{preferred_time}:00", data.get("reason", ""), start, data["occurrence_count"]),
    )

    created, skipped = [], []
    for d in dates:
        # Duplicate/conflict guard: skip a date if this patient already has a
        # live request or confirmed appointment with this doctor at this time.
        clash = query(
            """SELECT id FROM appointment_requests
               WHERE doctor_id=%s AND patient_id=%s AND requested_date=%s AND requested_time=%s
                     AND status NOT IN ('REJECTED','CANCELLED')
               UNION
               SELECT id FROM appointments WHERE doctor_id=%s AND patient_id=%s
                     AND appointment_date=%s AND appointment_time=%s AND status NOT IN ('CANCELLED','NO_SHOW')""",
            (data["doctor_id"], g.profile_id, d, f"{preferred_time}:00",
             data["doctor_id"], g.profile_id, d, f"{preferred_time}:00"),
        )
        if clash:
            execute(
                """INSERT INTO recurring_appointment_occurrences
                   (plan_id, occurrence_date, occurrence_time, status, failure_reason)
                   VALUES (%s,%s,%s,'FAILED',%s)""",
                (plan_id, d, f"{preferred_time}:00", "A conflicting appointment already exists on this date"),
            )
            skipped.append(d.isoformat())
            continue

        slots = generate_slots(data["doctor_id"], data["clinic_id"], d.isoformat())
        slot = next((s for s in slots if s["time"] == preferred_time), None)
        if not slot or not slot["available"]:
            execute(
                """INSERT INTO recurring_appointment_occurrences
                   (plan_id, occurrence_date, occurrence_time, status, failure_reason)
                   VALUES (%s,%s,%s,'FAILED',%s)""",
                (plan_id, d, f"{preferred_time}:00", "Slot not available on this date"),
            )
            skipped.append(d.isoformat())
            continue

        request_id = execute(
            """INSERT INTO appointment_requests
               (patient_id, family_member_id, doctor_id, clinic_id, requested_date, requested_time, reason, status)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'PENDING')""",
            (g.profile_id, data.get("family_member_id"), data["doctor_id"], data["clinic_id"],
             d, f"{preferred_time}:00", data.get("reason", f"Recurring visit ({data['frequency'].title()})")),
        )
        execute(
            """INSERT INTO recurring_appointment_occurrences
               (plan_id, occurrence_date, occurrence_time, status, appointment_request_id)
               VALUES (%s,%s,%s,'BOOKED',%s)""",
            (plan_id, d, f"{preferred_time}:00", request_id),
        )
        created.append(d.isoformat())

    if not created:
        execute("UPDATE recurring_appointment_plans SET status='CANCELLED' WHERE id=%s", (plan_id,))
        return jsonify({"error": "None of the requested dates could be booked", "skipped": skipped}), 409

    add_audit(g.user_id, "patient", "RECURRING_PLAN_CREATED", f"Plan #{plan_id}: {len(created)} visits requested")
    return jsonify({"plan_id": plan_id, "created_dates": created, "skipped_dates": skipped}), 201


@bp.get("")
@require_auth(["patient"])
def list_plans():
    plans = query(
        """SELECT rp.*, d.full_name AS doctor_name, c.name AS clinic_name, fm.full_name AS family_member_name
           FROM recurring_appointment_plans rp
           JOIN doctors d ON d.id = rp.doctor_id
           JOIN clinics c ON c.id = rp.clinic_id
           LEFT JOIN family_members fm ON fm.id = rp.family_member_id
           WHERE rp.patient_id=%s ORDER BY rp.created_at DESC""",
        (g.profile_id,),
    )
    return jsonify(plans)


def _owned_plan(plan_id):
    return query(
        "SELECT * FROM recurring_appointment_plans WHERE id=%s AND patient_id=%s",
        (plan_id, g.profile_id), fetchone=True,
    )


@bp.get("/<int:plan_id>/occurrences")
@require_auth(["patient"])
def list_occurrences(plan_id):
    if not _owned_plan(plan_id):
        return jsonify({"error": "Plan not found"}), 404
    occs = query(
        """SELECT o.*, ar.status AS request_status
           FROM recurring_appointment_occurrences o
           LEFT JOIN appointment_requests ar ON ar.id = o.appointment_request_id
           WHERE o.plan_id=%s ORDER BY o.occurrence_date""",
        (plan_id,),
    )
    return jsonify(occs)


@bp.post("/<int:plan_id>/pause")
@require_auth(["patient"])
def pause_plan(plan_id):
    plan = _owned_plan(plan_id)
    if not plan:
        return jsonify({"error": "Plan not found"}), 404
    if plan["status"] != "ACTIVE":
        return jsonify({"error": f"Cannot pause a plan in status {plan['status']}"}), 409
    execute("UPDATE recurring_appointment_plans SET status='PAUSED' WHERE id=%s", (plan_id,))
    add_audit(g.user_id, "patient", "RECURRING_PLAN_PAUSED", f"Plan #{plan_id}")
    return jsonify({"status": "PAUSED"})


@bp.post("/<int:plan_id>/resume")
@require_auth(["patient"])
def resume_plan(plan_id):
    plan = _owned_plan(plan_id)
    if not plan:
        return jsonify({"error": "Plan not found"}), 404
    if plan["status"] != "PAUSED":
        return jsonify({"error": f"Cannot resume a plan in status {plan['status']}"}), 409
    execute("UPDATE recurring_appointment_plans SET status='ACTIVE' WHERE id=%s", (plan_id,))
    add_audit(g.user_id, "patient", "RECURRING_PLAN_RESUMED", f"Plan #{plan_id}")
    return jsonify({"status": "ACTIVE"})


@bp.post("/<int:plan_id>/cancel")
@require_auth(["patient"])
def cancel_plan(plan_id):
    plan = _owned_plan(plan_id)
    if not plan:
        return jsonify({"error": "Plan not found"}), 404
    if plan["status"] in ("CANCELLED", "COMPLETED"):
        return jsonify({"error": f"Plan already {plan['status'].lower()}"}), 409

    # Cancel every future, still-pending individual request tied to this plan.
    future_occs = query(
        """SELECT o.id, o.appointment_request_id FROM recurring_appointment_occurrences o
           WHERE o.plan_id=%s AND o.occurrence_date >= CURDATE() AND o.status='BOOKED'""",
        (plan_id,),
    )
    for occ in future_occs:
        if occ["appointment_request_id"]:
            req = query(
                "SELECT status FROM appointment_requests WHERE id=%s", (occ["appointment_request_id"],), fetchone=True,
            )
            if req and req["status"] in ("PENDING", "UNDER_REVIEW"):
                execute("UPDATE appointment_requests SET status='CANCELLED' WHERE id=%s", (occ["appointment_request_id"],))
        execute("UPDATE recurring_appointment_occurrences SET status='CANCELLED' WHERE id=%s", (occ["id"],))

    execute("UPDATE recurring_appointment_plans SET status='CANCELLED' WHERE id=%s", (plan_id,))
    add_audit(g.user_id, "patient", "RECURRING_PLAN_CANCELLED", f"Plan #{plan_id}")
    return jsonify({"status": "CANCELLED", "cancelled_future_visits": len(future_occs)})
