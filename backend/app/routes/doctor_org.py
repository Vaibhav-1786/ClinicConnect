from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth, issue_token, hash_password
from app.utils.helpers import add_audit, add_notification, gen_sequential_code, gen_temp_password

bp = Blueprint("doctor_org", __name__, url_prefix="/api/doctor")


def _current_doctor():
    return query("SELECT * FROM doctors WHERE id=%s", (g.profile_id,), fetchone=True)


def _current_clinic():
    if not g.clinic_id:
        return None
    return query("SELECT * FROM clinics WHERE id=%s", (g.clinic_id,), fetchone=True)


@bp.get("/organizations")
@require_auth(["doctor"])
def list_organizations():
    """All approved, active organizations this doctor can work at."""
    orgs = query(
        """SELECT c.id, c.clinic_code, c.name, c.org_type, c.city_id, ci.name AS city_name
           FROM clinic_doctors cd
           JOIN clinics c ON c.id = cd.clinic_id
           LEFT JOIN cities ci ON ci.id = c.city_id
           WHERE cd.doctor_id=%s AND cd.status='active' AND c.status='active' AND c.approval_status='APPROVED'
           ORDER BY c.name""",
        (g.profile_id,),
    )
    return jsonify({"organizations": orgs, "current_clinic_id": g.clinic_id})


@bp.post("/switch-organization")
@require_auth(["doctor"])
def switch_organization():
    """
    Re-scope the current session to a different clinic/hospital WITHOUT
    logging the doctor out. A fresh token is issued carrying the new
    clinic_id claim; the frontend swaps it in place and reloads clinic-scoped
    data (appointments, patients, availability, prescriptions, billing...).
    """
    data = request.get_json(force=True) or {}
    clinic_id = data.get("clinic_id")
    if not clinic_id:
        return jsonify({"error": "clinic_id is required"}), 400

    link = query(
        """SELECT cd.id FROM clinic_doctors cd JOIN clinics c ON c.id = cd.clinic_id
           WHERE cd.doctor_id=%s AND cd.clinic_id=%s AND cd.status='active'
                 AND c.status='active' AND c.approval_status='APPROVED'""",
        (g.profile_id, clinic_id), fetchone=True,
    )
    if not link:
        return jsonify({"error": "You are not associated with that clinic/hospital"}), 403

    clinic = query("SELECT * FROM clinics WHERE id=%s", (clinic_id,), fetchone=True)
    new_token = issue_token(g.user_id, "doctor", {"profile_id": g.profile_id, "clinic_id": clinic["id"]})
    add_audit(g.user_id, "doctor", "SWITCH_ORGANIZATION", f"-> {clinic['clinic_code']}")
    return jsonify({
        "token": new_token,
        "clinic": {"id": clinic["id"], "clinic_code": clinic["clinic_code"], "name": clinic["name"], "org_type": clinic["org_type"]},
    })


@bp.get("/dashboard")
@require_auth(["doctor"])
def dashboard():
    doc = _current_doctor()
    clinic = _current_clinic()
    if not clinic:
        return jsonify({"error": "No clinic/hospital selected for this session"}), 400

    stats = {
        "todays_appointments": query(
            "SELECT COUNT(*) c FROM appointments WHERE doctor_id=%s AND clinic_id=%s AND appointment_date=CURDATE()",
            (g.profile_id, clinic["id"]), fetchone=True)["c"],
        "pending_appointments": query(
            "SELECT COUNT(*) c FROM appointments WHERE doctor_id=%s AND clinic_id=%s AND status IN ('CONFIRMED','CHECKED_IN')",
            (g.profile_id, clinic["id"]), fetchone=True)["c"],
        "completed_appointments": query(
            "SELECT COUNT(*) c FROM appointments WHERE doctor_id=%s AND clinic_id=%s AND status='COMPLETED'",
            (g.profile_id, clinic["id"]), fetchone=True)["c"],
        "total_patients": query(
            "SELECT COUNT(DISTINCT patient_id) c FROM appointments WHERE doctor_id=%s AND clinic_id=%s",
            (g.profile_id, clinic["id"]), fetchone=True)["c"],
    }
    todays_schedule = query(
        """SELECT a.id, a.appointment_time, a.status, p.full_name AS patient_name
           FROM appointments a JOIN patients p ON p.id = a.patient_id
           WHERE a.doctor_id=%s AND a.clinic_id=%s AND a.appointment_date=CURDATE()
           ORDER BY a.appointment_time""",
        (g.profile_id, clinic["id"]),
    )
    return jsonify({
        "doctor": {
            "id": doc["id"], "doctor_code": doc["doctor_code"], "full_name": doc["full_name"],
            "specialization": doc["specialization"], "qualification": doc["qualification"],
            "experience_years": doc["experience_years"], "registration_number": doc["registration_number"],
            "consultation_fee": float(doc["consultation_fee"] or 0),
        },
        "clinic": {
            "id": clinic["id"], "clinic_code": clinic["clinic_code"], "name": clinic["name"], "org_type": clinic["org_type"],
        },
        "stats": stats,
        "todays_schedule": todays_schedule,
    })


# ---------------- Doctor creates a receptionist for the CURRENT clinic only ----------------
@bp.post("/receptionists")
@require_auth(["doctor"])
def add_receptionist():
    if not g.clinic_id:
        return jsonify({"error": "Select a clinic/hospital before adding a receptionist"}), 400

    data = request.get_json(force=True) or {}
    required = ["full_name", "mobile", "email"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    existing = query("SELECT id FROM users WHERE email=%s", (data["email"],), fetchone=True)
    if existing:
        return jsonify({"error": "Email already registered"}), 409

    temp_password = gen_temp_password()
    user_id = execute(
        "INSERT INTO users (role, email, phone, password_hash) VALUES ('receptionist', %s, %s, %s)",
        (data["email"], data.get("mobile"), hash_password(temp_password)),
    )
    receptionist_code = gen_sequential_code("REC")
    rec_id = execute(
        """INSERT INTO receptionists
           (user_id, receptionist_code, full_name, clinic_id, added_by_doctor_id, mobile, address,
            gender, dob, joining_date, emergency_contact, notes, is_active)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1)""",
        (
            user_id, receptionist_code, data["full_name"], g.clinic_id, g.profile_id, data.get("mobile"),
            data.get("address"), data.get("gender"), data.get("dob"), data.get("joining_date"),
            data.get("emergency_contact"), data.get("notes"),
        ),
    )
    clinic = query("SELECT clinic_code, name FROM clinics WHERE id=%s", (g.clinic_id,), fetchone=True)
    add_notification(
        user_id, "account_created", "Welcome to ClinicConnect",
        f"Your receptionist account was created for {clinic['name']}.\n"
        f"Receptionist ID: {receptionist_code}\nClinic/Hospital ID: {clinic['clinic_code']}",
    )
    add_audit(g.user_id, "doctor", "RECEPTIONIST_CREATED", f"{receptionist_code} @ {clinic['clinic_code']}")

    return jsonify({
        "receptionist_id": rec_id,
        "credentials": {
            "receptionist_code": receptionist_code,
            "clinic_code": clinic["clinic_code"],
            "temporary_password": temp_password,
        },
    }), 201


@bp.get("/receptionists")
@require_auth(["doctor"])
def list_receptionists():
    if not g.clinic_id:
        return jsonify([])
    rows = query(
        """SELECT id, receptionist_code, full_name, mobile, is_active, joining_date
           FROM receptionists WHERE clinic_id=%s AND added_by_doctor_id=%s
           ORDER BY id DESC""",
        (g.clinic_id, g.profile_id),
    )
    return jsonify(rows)
