import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute, get_conn
from app.utils.auth import require_auth
from app.utils.helpers import add_audit, add_notification
from app.routes.waitlist import check_waitlist_on_cancellation
from app.utils.doctor_access import (
    get_receptionist_access,
    receptionist_can_access_doctor,
    doctor_filter_sql,
)

bp = Blueprint("appointments", __name__, url_prefix="/api/appointments")


def _receptionist_authorized_for_doctor(doctor_id):
    """Must be called only when g.role == 'receptionist'. Checks the
    shared-receptionist scope from migration_018 on top of the existing
    clinic_id isolation."""
    rec = get_receptionist_access(g.profile_id)
    access_type = rec["access_type"] if rec else "ALL"
    return receptionist_can_access_doctor(g.profile_id, access_type, g.clinic_id, doctor_id)


# ---------------- Patient: create request ----------------
@bp.post("/request")
@require_auth(["patient"])
def create_request():
    data = request.get_json(force=True) or {}
    required = ["doctor_id", "clinic_id", "requested_date", "requested_time"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    req_date = datetime.datetime.strptime(data["requested_date"], "%Y-%m-%d").date()
    if req_date < datetime.date.today():
        return jsonify({"error": "Cannot request an appointment in the past"}), 400

    # doctor must actually be linked to the clinic
    link = query(
        "SELECT id FROM clinic_doctors WHERE clinic_id=%s AND doctor_id=%s",
        (data["clinic_id"], data["doctor_id"]), fetchone=True,
    )
    if not link:
        return jsonify({"error": "Doctor is not associated with this clinic"}), 400

    # "Appointment For" — Myself (None) or a specific family member. Patients
    # may only book on behalf of a dependent they themselves own.
    family_member_id = data.get("family_member_id")
    if family_member_id:
        owned = query(
            "SELECT id FROM family_members WHERE id=%s AND patient_id=%s AND is_active=1",
            (family_member_id, g.profile_id), fetchone=True,
        )
        if not owned:
            return jsonify({"error": "Family member not found"}), 400

    if data.get("consultation_mode") and data["consultation_mode"] not in ("IN_PERSON", "ONLINE"):
        return jsonify({"error": "consultation_mode must be IN_PERSON or ONLINE"}), 400

    request_id = execute(
        """INSERT INTO appointment_requests
           (patient_id, family_member_id, doctor_id, clinic_id, requested_date, requested_time, reason, consultation_mode, status)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'PENDING')""",
        (g.profile_id, family_member_id, data["doctor_id"], data["clinic_id"], data["requested_date"],
         data["requested_time"], data.get("reason", ""), data.get("consultation_mode", "IN_PERSON")),
    )
    add_audit(g.user_id, "patient", "APPOINTMENT_REQUEST_CREATED", f"Request #{request_id}")
    return jsonify({"request_id": request_id, "status": "PENDING"}), 201


@bp.get("/patient")
@require_auth(["patient"])
def patient_appointments():
    requests_ = query(
        """SELECT ar.*, d.full_name AS doctor_name, c.name AS clinic_name, fm.full_name AS family_member_name
           FROM appointment_requests ar
           JOIN doctors d ON d.id = ar.doctor_id
           JOIN clinics c ON c.id = ar.clinic_id
           LEFT JOIN family_members fm ON fm.id = ar.family_member_id
           WHERE ar.patient_id=%s ORDER BY ar.created_at DESC""",
        (g.profile_id,),
    )
    confirmed = query(
        """SELECT a.*, d.full_name AS doctor_name, c.name AS clinic_name, fm.full_name AS family_member_name
           FROM appointments a
           JOIN doctors d ON d.id = a.doctor_id
           JOIN clinics c ON c.id = a.clinic_id
           LEFT JOIN family_members fm ON fm.id = a.family_member_id
           WHERE a.patient_id=%s ORDER BY a.appointment_date DESC, a.appointment_time DESC""",
        (g.profile_id,),
    )
    return jsonify({"requests": requests_, "appointments": confirmed})


# ---------------- Receptionist: manage requests ----------------
@bp.get("/receptionist")
@require_auth(["receptionist"])
def receptionist_requests():
    # Data isolation: a receptionist only ever sees requests for their own
    # clinic/hospital, AND (see migration_018) only for doctors within
    # their permitted scope — hospital-wide by default, narrower if an
    # admin has restricted this receptionist to a department or specific
    # doctors.
    status = request.args.get("status")
    rec = get_receptionist_access(g.profile_id)
    access_type = rec["access_type"] if rec else "ALL"
    doc_filter_sql, doc_filter_params = doctor_filter_sql(g.profile_id, access_type, "ar.doctor_id")
    # Approving a request creates a SEPARATE row in `appointments` (linked via
    # request_id) — that appointments.id, not the request's own id, is what
    # billing/invoices/messaging/video actually key off. Join it through here
    # so the frontend can show the receptionist the ID they actually need.
    sql = """SELECT ar.*, p.full_name AS patient_name, p.patient_code, d.full_name AS doctor_name,
                     c.name AS clinic_name, a.id AS appointment_id
              FROM appointment_requests ar
              JOIN patients p ON p.id = ar.patient_id
              JOIN doctors d ON d.id = ar.doctor_id
              JOIN clinics c ON c.id = ar.clinic_id
              LEFT JOIN appointments a ON a.request_id = ar.id
              WHERE ar.clinic_id=%s""" + doc_filter_sql
    params = [g.clinic_id] + doc_filter_params
    if status:
        sql += " AND ar.status=%s"; params.append(status)
    sql += " ORDER BY ar.created_at DESC"
    return jsonify(query(sql, params))


@bp.get("/receptionist/doctors")
@require_auth(["receptionist"])
def receptionist_doctors():
    rec = get_receptionist_access(g.profile_id)
    access_type = rec["access_type"] if rec else "ALL"
    doc_filter_sql, doc_filter_params = doctor_filter_sql(g.profile_id, access_type, "d.id")
    return jsonify(query(
        """SELECT d.id, d.full_name, d.specialization FROM doctors d
           JOIN clinic_doctors cd ON cd.doctor_id = d.id
           WHERE cd.clinic_id=%s AND cd.status='active'""" + doc_filter_sql + """
           ORDER BY d.full_name""",
        [g.clinic_id] + doc_filter_params,
    ))


@bp.get("/receptionist/appointments/today")
@require_auth(["receptionist"])
def receptionist_appointments_today():
    """Confirmed, not-yet-checked-in appointments for today — used to populate
    the OPD check-in dropdown."""
    return jsonify(query(
        """SELECT a.id, a.appointment_time, a.status, p.full_name AS patient_name, d.full_name AS doctor_name
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           JOIN doctors d ON d.id = a.doctor_id
           WHERE a.clinic_id=%s AND a.appointment_date=CURDATE() AND a.status='CONFIRMED'
           ORDER BY a.appointment_time""",
        (g.clinic_id,),
    ))


@bp.get("/receptionist/<int:request_id>/check-availability")
@require_auth(["receptionist"])
def check_availability(request_id):
    from app.services.slots import generate_slots
    req = query("SELECT * FROM appointment_requests WHERE id=%s", (request_id,), fetchone=True)
    if not req:
        return jsonify({"error": "Not found"}), 404
    if req["clinic_id"] != g.clinic_id:
        return jsonify({"error": "Forbidden: request belongs to a different clinic/hospital"}), 403
    if not _receptionist_authorized_for_doctor(req["doctor_id"]):
        return jsonify({"error": "Forbidden: you are not authorized to manage this doctor"}), 403
    slots = generate_slots(req["doctor_id"], req["clinic_id"], str(req["requested_date"]))
    requested_slot = next(
        (s for s in slots if s["time"] == str(req["requested_time"])[:5]), None
    )
    return jsonify({"slots": slots, "requested_slot_available": bool(requested_slot and requested_slot["available"])})


@bp.post("/<int:request_id>/approve")
@require_auth(["receptionist"])
def approve_request(request_id):
    req = query("SELECT * FROM appointment_requests WHERE id=%s", (request_id,), fetchone=True)
    if not req:
        return jsonify({"error": "Request not found"}), 404
    if req["clinic_id"] != g.clinic_id:
        return jsonify({"error": "Forbidden: request belongs to a different clinic/hospital"}), 403
    if not _receptionist_authorized_for_doctor(req["doctor_id"]):
        return jsonify({"error": "Forbidden: you are not authorized to manage this doctor"}), 403
    if req["status"] not in ("PENDING", "UNDER_REVIEW"):
        return jsonify({"error": f"Cannot approve a request in status {req['status']}"}), 409

    # Re-validate slot is free right before commit (prevents double-booking race)
    conn = get_conn()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """SELECT id FROM appointments WHERE doctor_id=%s AND appointment_date=%s
               AND appointment_time=%s AND status NOT IN ('CANCELLED','NO_SHOW') FOR UPDATE""",
            (req["doctor_id"], req["requested_date"], req["requested_time"]),
        )
        clash = cur.fetchone()
        on_leave = query(
            "SELECT id FROM doctor_leaves WHERE doctor_id=%s AND leave_date=%s",
            (req["doctor_id"], req["requested_date"]), fetchone=True,
        )
        if clash or on_leave:
            conn.rollback()
            return jsonify({"error": "Slot no longer available"}), 409

        cur.execute(
            """INSERT INTO appointments (request_id, patient_id, family_member_id, doctor_id, clinic_id,
               appointment_date, appointment_time, status, reason, consultation_mode)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'CONFIRMED',%s,%s)""",
            (req["id"], req["patient_id"], req.get("family_member_id"), req["doctor_id"], req["clinic_id"],
             req["requested_date"], req["requested_time"], req["reason"], req.get("consultation_mode", "IN_PERSON")),
        )
        appt_id = cur.lastrowid
        cur.execute(
            "UPDATE appointment_requests SET status='APPROVED', receptionist_id=%s WHERE id=%s",
            (g.profile_id, req["id"]),
        )
        conn.commit()
        cur.close()
    finally:
        conn.close()

    doctor = query("SELECT full_name FROM doctors WHERE id=%s", (req["doctor_id"],), fetchone=True)
    clinic = query("SELECT name FROM clinics WHERE id=%s", (req["clinic_id"],), fetchone=True)
    patient_user = query(
        "SELECT u.id FROM patients p JOIN users u ON u.id=p.user_id WHERE p.id=%s", (req["patient_id"],), fetchone=True
    )
    add_notification(
        patient_user["id"], "appointment_approved", "Appointment Approved",
        f"Your appointment has been approved.\nDoctor: Dr. {doctor['full_name']}\nClinic: {clinic['name']}\n"
        f"Date: {req['requested_date']}\nTime: {req['requested_time']}\nAppointment ID: {appt_id}",
    )
    add_audit(g.user_id, "receptionist", "APPOINTMENT_APPROVED", f"Request #{request_id} -> Appt #{appt_id}")
    return jsonify({"appointment_id": appt_id, "status": "APPROVED"})


@bp.post("/<int:request_id>/reject")
@require_auth(["receptionist"])
def reject_request(request_id):
    data = request.get_json(force=True) or {}
    req = query("SELECT * FROM appointment_requests WHERE id=%s", (request_id,), fetchone=True)
    if not req:
        return jsonify({"error": "Request not found"}), 404
    if req["clinic_id"] != g.clinic_id:
        return jsonify({"error": "Forbidden: request belongs to a different clinic/hospital"}), 403
    if not _receptionist_authorized_for_doctor(req["doctor_id"]):
        return jsonify({"error": "Forbidden: you are not authorized to manage this doctor"}), 403
    if req["status"] not in ("PENDING", "UNDER_REVIEW"):
        return jsonify({"error": f"Cannot reject a request in status {req['status']}"}), 409

    execute(
        "UPDATE appointment_requests SET status='REJECTED', receptionist_id=%s, decision_note=%s WHERE id=%s",
        (g.profile_id, data.get("reason", ""), request_id),
    )
    patient_user = query(
        "SELECT u.id FROM patients p JOIN users u ON u.id=p.user_id WHERE p.id=%s", (req["patient_id"],), fetchone=True
    )
    add_notification(
        patient_user["id"], "appointment_rejected", "Appointment Rejected",
        f"Your appointment request has been rejected.\nReason: {data.get('reason', 'Not specified')}",
    )
    add_audit(g.user_id, "receptionist", "APPOINTMENT_REJECTED", f"Request #{request_id}")
    check_waitlist_on_cancellation(req["doctor_id"], req["clinic_id"], req["requested_date"], req["requested_time"])
    return jsonify({"status": "REJECTED"})


@bp.post("/<int:request_id>/reschedule")
@require_auth(["receptionist"])
def reschedule_request(request_id):
    data = request.get_json(force=True) or {}
    required = ["new_date", "new_time"]
    if any(f not in data for f in required):
        return jsonify({"error": "new_date and new_time required"}), 400

    req = query("SELECT * FROM appointment_requests WHERE id=%s", (request_id,), fetchone=True)
    if not req:
        return jsonify({"error": "Request not found"}), 404
    if req["clinic_id"] != g.clinic_id:
        return jsonify({"error": "Forbidden: request belongs to a different clinic/hospital"}), 403
    if not _receptionist_authorized_for_doctor(req["doctor_id"]):
        return jsonify({"error": "Forbidden: you are not authorized to manage this doctor"}), 403

    execute(
        """UPDATE appointment_requests
           SET requested_date=%s, requested_time=%s, status='RESCHEDULED', receptionist_id=%s
           WHERE id=%s""",
        (data["new_date"], data["new_time"], g.profile_id, request_id),
    )
    doctor = query("SELECT full_name FROM doctors WHERE id=%s", (req["doctor_id"],), fetchone=True)
    patient_user = query(
        "SELECT u.id FROM patients p JOIN users u ON u.id=p.user_id WHERE p.id=%s", (req["patient_id"],), fetchone=True
    )
    add_notification(
        patient_user["id"], "appointment_rescheduled", "Appointment Rescheduled",
        f"Your appointment has been rescheduled.\nNew Date: {data['new_date']}\nNew Time: {data['new_time']}\n"
        f"Doctor: Dr. {doctor['full_name']}",
    )
    add_audit(g.user_id, "receptionist", "APPOINTMENT_RESCHEDULED", f"Request #{request_id}")
    return jsonify({"status": "RESCHEDULED"})


@bp.post("/<int:request_id>/cancel")
@require_auth(["receptionist", "patient"])
def cancel_request(request_id):
    req = query("SELECT * FROM appointment_requests WHERE id=%s", (request_id,), fetchone=True)
    if not req:
        return jsonify({"error": "Not found"}), 404
    if g.role == "patient" and req["patient_id"] != g.profile_id:
        return jsonify({"error": "Forbidden"}), 403
    if g.role == "receptionist" and req["clinic_id"] != g.clinic_id:
        return jsonify({"error": "Forbidden: request belongs to a different clinic/hospital"}), 403
    if g.role == "receptionist" and not _receptionist_authorized_for_doctor(req["doctor_id"]):
        return jsonify({"error": "Forbidden: you are not authorized to manage this doctor"}), 403
    execute("UPDATE appointment_requests SET status='CANCELLED' WHERE id=%s", (request_id,))
    add_audit(g.user_id, g.role, "APPOINTMENT_CANCELLED", f"Request #{request_id}")
    check_waitlist_on_cancellation(req["doctor_id"], req["clinic_id"], req["requested_date"], req["requested_time"])
    return jsonify({"status": "CANCELLED"})


# ---------------- Doctor: appointment list & lifecycle ----------------
@bp.get("/doctor")
@require_auth(["doctor"])
def doctor_appointments():
    date_filter = request.args.get("date")
    sql = """SELECT a.*, p.full_name AS patient_name, p.patient_code, c.name AS clinic_name
              FROM appointments a
              JOIN patients p ON p.id = a.patient_id
              JOIN clinics c ON c.id = a.clinic_id
              WHERE a.doctor_id=%s AND a.clinic_id=%s"""
    params = [g.profile_id, g.clinic_id]
    if date_filter:
        sql += " AND a.appointment_date=%s"; params.append(date_filter)
    sql += " ORDER BY a.appointment_date, a.appointment_time"
    return jsonify(query(sql, params))


# ---------------- Billing: appointment -> doctor's authoritative fee ----------------
@bp.get("/<int:appointment_id>/billing-info")
@require_auth(["receptionist", "doctor"])
def appointment_billing_info(appointment_id):
    """Everything the billing screen needs to auto-populate a consultation line
    item: the appointment's patient, its doctor, and that doctor's CURRENT
    consultation_fee. The fee always comes from appointment.doctor_id ->
    doctors.consultation_fee, never from a default or a manual entry."""
    appt = query(
        """SELECT a.id, a.patient_id, a.doctor_id, a.clinic_id,
                  a.appointment_date, a.appointment_time, a.status,
                  p.full_name AS patient_name, p.patient_code,
                  d.full_name AS doctor_name, d.specialization,
                  d.consultation_fee,
                  c.name AS clinic_name
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           JOIN doctors d ON d.id = a.doctor_id
           JOIN clinics c ON c.id = a.clinic_id
           WHERE a.id=%s""",
        (appointment_id,), fetchone=True,
    )
    if not appt:
        return jsonify({"error": "Appointment not found"}), 404

    # Keep the existing data-isolation model: staff only see their own clinic,
    # and a doctor only sees their own appointments.
    if g.role == "receptionist" and appt["clinic_id"] != g.clinic_id:
        return jsonify({"error": "Forbidden: appointment belongs to another clinic"}), 403
    if g.role == "receptionist" and not _receptionist_authorized_for_doctor(appt["doctor_id"]):
        return jsonify({"error": "Forbidden: you are not authorized to manage this doctor"}), 403
    if g.role == "doctor" and appt["doctor_id"] != g.profile_id:
        return jsonify({"error": "Forbidden: not your appointment"}), 403

    fee = appt["consultation_fee"]
    return jsonify({
        "appointment_id": appt["id"],
        "appointment_date": str(appt["appointment_date"]) if appt["appointment_date"] else None,
        "appointment_time": str(appt["appointment_time"]) if appt["appointment_time"] else None,
        "status": appt["status"],
        "patient_id": appt["patient_id"],
        "patient_name": appt["patient_name"],
        "patient_code": appt["patient_code"],
        "doctor_id": appt["doctor_id"],
        "doctor_name": appt["doctor_name"],
        "specialization": appt["specialization"],
        "consultation_fee": float(fee) if fee is not None else 0.0,
        "consultation_fee_missing": fee is None,
        "clinic_id": appt["clinic_id"],
        "clinic_name": appt["clinic_name"],
    })


VALID_TRANSITIONS = {
    "CONFIRMED": {"CHECKED_IN", "CANCELLED", "NO_SHOW"},
    "CHECKED_IN": {"IN_CONSULTATION", "CANCELLED"},
    "IN_CONSULTATION": {"COMPLETED"},
}


@bp.post("/<int:appointment_id>/status")
@require_auth(["doctor", "receptionist"])
def update_status(appointment_id):
    data = request.get_json(force=True) or {}
    new_status = data.get("status")
    appt = query("SELECT * FROM appointments WHERE id=%s", (appointment_id,), fetchone=True)
    if not appt:
        return jsonify({"error": "Not found"}), 404
    if appt["clinic_id"] != g.clinic_id:
        return jsonify({"error": "Forbidden: appointment belongs to a different clinic/hospital"}), 403
    if g.role == "receptionist" and not _receptionist_authorized_for_doctor(appt["doctor_id"]):
        return jsonify({"error": "Forbidden: you are not authorized to manage this doctor"}), 403
    allowed = VALID_TRANSITIONS.get(appt["status"], set())
    if new_status not in allowed:
        return jsonify({"error": f"Invalid transition {appt['status']} -> {new_status}"}), 400
    execute("UPDATE appointments SET status=%s WHERE id=%s", (new_status, appointment_id))
    add_audit(g.user_id, g.role, "APPOINTMENT_STATUS_CHANGE", f"#{appointment_id} -> {new_status}")
    if new_status in ("CANCELLED", "NO_SHOW"):
        check_waitlist_on_cancellation(appt["doctor_id"], appt["clinic_id"], appt["appointment_date"], appt["appointment_time"])
    if new_status == "COMPLETED":
        from app.routes.care_checklist import generate_checklist_for_appointment
        generate_checklist_for_appointment(appointment_id, appt["patient_id"], appt["doctor_id"])
    return jsonify({"status": new_status})


# ---------------- Receptionist: no-show risk for a given day ----------------
# A lightweight heuristic, not a trained model: a patient's own historical
# no-show rate across all their past appointments (this clinic or any),
# surfaced so reception can proactively confirm or double-book high-risk slots.
NO_SHOW_RISK_MIN_HISTORY = 2       # need at least this many past appointments to judge
NO_SHOW_RISK_THRESHOLD = 0.3       # flag as high-risk above this rate


@bp.get("/no-show-risk")
@require_auth(["receptionist", "doctor"])
def no_show_risk():
    date_filter = request.args.get("date") or datetime.date.today().isoformat()
    todays = query(
        """SELECT a.id, a.appointment_time, a.patient_id, p.full_name AS patient_name,
                  p.patient_code, d.full_name AS doctor_name
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           JOIN doctors d ON d.id = a.doctor_id
           WHERE a.clinic_id=%s AND a.appointment_date=%s
                 AND a.status IN ('CONFIRMED','CHECKED_IN')
           ORDER BY a.appointment_time""",
        (g.clinic_id, date_filter),
    )
    results = []
    for appt in todays:
        history = query(
            """SELECT COUNT(*) AS total, SUM(status='NO_SHOW') AS no_shows
               FROM appointments WHERE patient_id=%s AND appointment_date < %s""",
            (appt["patient_id"], date_filter), fetchone=True,
        )
        total = history["total"] or 0
        no_shows = history["no_shows"] or 0
        rate = (no_shows / total) if total >= NO_SHOW_RISK_MIN_HISTORY else 0
        results.append({
            **appt,
            "past_appointments": total,
            "past_no_shows": no_shows,
            "no_show_rate": round(rate, 2),
            "high_risk": rate >= NO_SHOW_RISK_THRESHOLD,
        })
    results.sort(key=lambda r: r["no_show_rate"], reverse=True)
    return jsonify(results)