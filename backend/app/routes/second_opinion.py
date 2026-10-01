import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit, add_notification

bp = Blueprint("second_opinion", __name__, url_prefix="/api/second-opinion")


@bp.get("/doctors")
@require_auth(["patient"])
def eligible_doctors():
    """Doctors the patient can request a second opinion from — any doctor
    other than the one who wrote the prescription being reviewed."""
    exclude_id = request.args.get("exclude_doctor_id")
    sql = "SELECT id, full_name, specialization, qualification, experience_years FROM doctors"
    params = []
    if exclude_id:
        sql += " WHERE id != %s"
        params.append(exclude_id)
    sql += " ORDER BY full_name"
    return jsonify(query(sql, params))


@bp.post("")
@require_auth(["patient"])
def create_request():
    data = request.get_json(force=True) or {}
    prescription_id = data.get("prescription_id")
    target_doctor_id = data.get("target_doctor_id")
    consent_given = bool(data.get("consent_given"))

    if not target_doctor_id:
        return jsonify({"error": "target_doctor_id is required"}), 400
    if not consent_given:
        return jsonify({"error": "Patient consent is required to share your records for a second opinion"}), 400

    original_doctor_id = None
    appointment_id = None
    if prescription_id:
        presc = query(
            "SELECT * FROM prescriptions WHERE id=%s AND patient_id=%s", (prescription_id, g.profile_id), fetchone=True,
        )
        if not presc:
            return jsonify({"error": "Prescription not found"}), 404
        original_doctor_id = presc["doctor_id"]
        appointment_id = presc["appointment_id"]
        if str(original_doctor_id) == str(target_doctor_id):
            return jsonify({"error": "Choose a different doctor than the one who wrote this prescription"}), 400

    target_doctor = query("SELECT * FROM doctors WHERE id=%s", (target_doctor_id,), fetchone=True)
    if not target_doctor:
        return jsonify({"error": "Selected doctor not found"}), 404

    req_id = execute(
        """INSERT INTO second_opinion_requests
           (patient_id, prescription_id, appointment_id, original_doctor_id, target_doctor_id, patient_note, consent_given)
           VALUES (%s,%s,%s,%s,%s,%s,%s)""",
        (g.profile_id, prescription_id, appointment_id, original_doctor_id, target_doctor_id,
         data.get("patient_note", ""), 1),
    )
    add_notification(
        target_doctor["user_id"], "second_opinion",
        "New second opinion request",
        "A patient has requested your review of their diagnosis/prescription.",
    )
    add_audit(g.user_id, "patient", "SECOND_OPINION_REQUESTED", f"#{req_id} -> doctor {target_doctor_id}")
    return jsonify(_serialize(req_id)), 201


def _serialize(req_id):
    return query(
        """SELECT sor.*, dt.full_name AS target_doctor_name, do.full_name AS original_doctor_name
           FROM second_opinion_requests sor
           JOIN doctors dt ON dt.id = sor.target_doctor_id
           LEFT JOIN doctors do ON do.id = sor.original_doctor_id
           WHERE sor.id=%s""",
        (req_id,), fetchone=True,
    )


@bp.get("/mine")
@require_auth(["patient"])
def my_requests():
    rows = query(
        """SELECT sor.*, dt.full_name AS target_doctor_name, do.full_name AS original_doctor_name
           FROM second_opinion_requests sor
           JOIN doctors dt ON dt.id = sor.target_doctor_id
           LEFT JOIN doctors do ON do.id = sor.original_doctor_id
           WHERE sor.patient_id=%s ORDER BY sor.created_at DESC""",
        (g.profile_id,),
    )
    return jsonify(rows)


@bp.get("/inbox")
@require_auth(["doctor"])
def inbox():
    rows = query(
        """SELECT sor.*, p.full_name AS patient_name, p.patient_code
           FROM second_opinion_requests sor
           JOIN patients p ON p.id = sor.patient_id
           WHERE sor.target_doctor_id=%s ORDER BY
             (sor.status = 'PENDING') DESC, sor.created_at DESC""",
        (g.profile_id,),
    )
    return jsonify(rows)


@bp.get("/<int:request_id>/context")
@require_auth(["doctor"])
def request_context(request_id):
    """The clinical context (diagnosis + medicines + vitals) the reviewing
    doctor needs — only exposed once the request targets them."""
    req = query(
        "SELECT * FROM second_opinion_requests WHERE id=%s AND target_doctor_id=%s",
        (request_id, g.profile_id), fetchone=True,
    )
    if not req:
        return jsonify({"error": "Not found"}), 404
    result = {"request": req}
    if req["prescription_id"]:
        presc = query("SELECT * FROM prescriptions WHERE id=%s", (req["prescription_id"],), fetchone=True)
        items = query(
            """SELECT COALESCE(pi.medicine_name, m.name) AS name, pi.dosage, pi.frequency, pi.duration FROM prescription_items pi
               LEFT JOIN medicines m ON m.id = pi.medicine_id WHERE pi.prescription_id=%s""",
            (req["prescription_id"],),
        )
        result["prescription"] = presc
        result["medicines"] = items
    return jsonify(result)


@bp.post("/<int:request_id>/respond")
@require_auth(["doctor"])
def respond(request_id):
    req = query(
        "SELECT * FROM second_opinion_requests WHERE id=%s AND target_doctor_id=%s",
        (request_id, g.profile_id), fetchone=True,
    )
    if not req:
        return jsonify({"error": "Not found"}), 404
    if req["status"] not in ("PENDING", "ACCEPTED"):
        return jsonify({"error": f"Request already {req['status'].lower()}"}), 400

    data = request.get_json(force=True) or {}
    new_status = data.get("status")
    if new_status not in ("ACCEPTED", "DECLINED", "REVIEWED"):
        return jsonify({"error": "status must be ACCEPTED, DECLINED or REVIEWED"}), 400
    if new_status == "REVIEWED" and not (data.get("opinion_text") or "").strip():
        return jsonify({"error": "opinion_text is required to submit a review"}), 400

    execute(
        """UPDATE second_opinion_requests SET status=%s, opinion_text=%s, responded_at=%s WHERE id=%s""",
        (new_status, data.get("opinion_text", req.get("opinion_text")), datetime.datetime.utcnow(), request_id),
    )
    patient = query("SELECT user_id FROM patients WHERE id=%s", (req["patient_id"],), fetchone=True)
    if patient:
        label = {"ACCEPTED": "accepted", "DECLINED": "declined", "REVIEWED": "reviewed"}[new_status]
        add_notification(
            patient["user_id"], "second_opinion", f"Second opinion request {label}",
            "A doctor has responded to your second opinion request. Check the details in your app.",
        )
    add_audit(g.user_id, "doctor", "SECOND_OPINION_RESPONDED", f"#{request_id} -> {new_status}")
    return jsonify(_serialize(request_id))
