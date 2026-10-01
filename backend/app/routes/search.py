from flask import Blueprint, request, jsonify, g

from app.utils.db import query
from app.utils.auth import require_auth

bp = Blueprint("search", __name__, url_prefix="/api/search")

LIMIT = 8


def _like(q):
    return f"%{q}%"


@bp.get("")
@require_auth()
def global_search():
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify({"error": "Enter at least 2 characters to search"}), 400
    like = _like(q)

    if g.role == "patient":
        return jsonify(_patient_search(like, q))
    if g.role == "doctor":
        return jsonify(_doctor_search(like, q))
    if g.role == "receptionist":
        return jsonify(_receptionist_search(like, q))
    if g.role == "admin":
        return jsonify(_admin_search(like, q))
    return jsonify({"error": "Unsupported role"}), 400


def _patient_search(like, q):
    doctors = query(
        """SELECT id, full_name, specialization, consultation_fee FROM doctors
           WHERE (full_name LIKE %s OR specialization LIKE %s) AND is_active=1 AND verification_status='APPROVED'
           LIMIT %s""",
        (like, like, LIMIT),
    )
    clinics = query(
        """SELECT id, name, org_type, address FROM clinics
           WHERE name LIKE %s AND status='active' AND approval_status='APPROVED' LIMIT %s""",
        (like, LIMIT),
    )
    appointments = query(
        """SELECT a.id, a.appointment_date, a.appointment_time, a.status, d.full_name AS doctor_name
           FROM appointments a JOIN doctors d ON d.id = a.doctor_id
           WHERE a.patient_id=%s AND (a.reason LIKE %s OR d.full_name LIKE %s)
           ORDER BY a.appointment_date DESC LIMIT %s""",
        (g.profile_id, like, like, LIMIT),
    )
    prescriptions = query(
        """SELECT DISTINCT p.id, p.prescription_date, p.diagnosis_text, d.full_name AS doctor_name
           FROM prescriptions p
           JOIN doctors d ON d.id = p.doctor_id
           LEFT JOIN prescription_items pi ON pi.prescription_id = p.id
           LEFT JOIN medicines m ON m.id = pi.medicine_id
           WHERE p.patient_id=%s AND (p.diagnosis_text LIKE %s OR COALESCE(pi.medicine_name, m.name) LIKE %s)
           ORDER BY p.prescription_date DESC LIMIT %s""",
        (g.profile_id, like, like, LIMIT),
    )
    return {"doctors": doctors, "clinics": clinics, "appointments": appointments, "prescriptions": prescriptions}


def _doctor_search(like, q):
    # A doctor may only see patients they have actually treated (had an
    # appointment with) — never the full patient directory.
    patients = query(
        """SELECT DISTINCT p.id, p.patient_code, p.full_name, p.gender, p.dob
           FROM patients p JOIN appointments a ON a.patient_id = p.id
           WHERE a.doctor_id=%s AND (p.full_name LIKE %s OR p.patient_code LIKE %s)
           LIMIT %s""",
        (g.profile_id, like, like, LIMIT),
    )
    appointments = query(
        """SELECT a.id, a.appointment_date, a.appointment_time, a.status, p.full_name AS patient_name
           FROM appointments a JOIN patients p ON p.id = a.patient_id
           WHERE a.doctor_id=%s AND (p.full_name LIKE %s OR a.reason LIKE %s)
           ORDER BY a.appointment_date DESC LIMIT %s""",
        (g.profile_id, like, like, LIMIT),
    )
    organizations = query(
        """SELECT c.id, c.name, c.org_type FROM clinics c
           JOIN clinic_doctors cd ON cd.clinic_id = c.id
           WHERE cd.doctor_id=%s AND c.name LIKE %s LIMIT %s""",
        (g.profile_id, like, LIMIT),
    )
    return {"patients": patients, "appointments": appointments, "organizations": organizations}


def _receptionist_search(like, q):
    # Patients: a front desk needs to find ANY registered patient by their
    # exact code/phone to check them in (e.g. a first-time walk-in) — but a
    # loose name search is scoped to patients already associated with this
    # clinic, so receptionists can't casually browse the whole platform.
    patients = query(
        """SELECT DISTINCT p.id, p.patient_code, p.full_name, u.phone
           FROM patients p JOIN users u ON u.id = p.user_id
           WHERE p.patient_code LIKE %s OR u.phone LIKE %s
              OR (p.full_name LIKE %s AND EXISTS (
                    SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.clinic_id=%s
                    UNION SELECT 1 FROM appointment_requests ar WHERE ar.patient_id = p.id AND ar.clinic_id=%s
                  ))
           LIMIT %s""",
        (like, like, like, g.clinic_id, g.clinic_id, LIMIT),
    )
    doctors = query(
        """SELECT d.id, d.full_name, d.specialization FROM doctors d
           JOIN clinic_doctors cd ON cd.doctor_id = d.id
           WHERE cd.clinic_id=%s AND d.full_name LIKE %s LIMIT %s""",
        (g.clinic_id, like, LIMIT),
    )
    appointments = query(
        """SELECT a.id, a.appointment_date, a.appointment_time, a.status,
                  p.full_name AS patient_name, d.full_name AS doctor_name
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           JOIN doctors d ON d.id = a.doctor_id
           WHERE a.clinic_id=%s AND (p.full_name LIKE %s OR d.full_name LIKE %s)
           ORDER BY a.appointment_date DESC LIMIT %s""",
        (g.clinic_id, like, like, LIMIT),
    )
    queue = query(
        """SELECT q.id, q.token_number, q.status, COALESCE(p.full_name, q.walk_in_name) AS patient_name
           FROM opd_queue q LEFT JOIN patients p ON p.id = q.patient_id
           WHERE q.clinic_id=%s AND DATE(q.check_in_time)=CURDATE()
                 AND (p.full_name LIKE %s OR q.walk_in_name LIKE %s)
           LIMIT %s""",
        (g.clinic_id, like, like, LIMIT),
    )
    return {"patients": patients, "doctors": doctors, "appointments": appointments, "queue": queue}


def _admin_search(like, q):
    patients = query(
        "SELECT id, patient_code, full_name FROM patients WHERE full_name LIKE %s OR patient_code LIKE %s LIMIT %s",
        (like, like, LIMIT),
    )
    doctors = query(
        "SELECT id, doctor_code, full_name, specialization, verification_status FROM doctors WHERE full_name LIKE %s OR doctor_code LIKE %s LIMIT %s",
        (like, like, LIMIT),
    )
    receptionists = query(
        "SELECT id, receptionist_code, full_name, clinic_id FROM receptionists WHERE full_name LIKE %s OR receptionist_code LIKE %s LIMIT %s",
        (like, like, LIMIT),
    )
    clinics = query(
        "SELECT id, clinic_code, name, org_type, approval_status FROM clinics WHERE name LIKE %s OR clinic_code LIKE %s LIMIT %s",
        (like, like, LIMIT),
    )
    applications = query(
        "SELECT id, full_name, clinic_name, status FROM doctor_applications WHERE full_name LIKE %s OR clinic_name LIKE %s LIMIT %s",
        (like, like, LIMIT),
    )
    appointments = query(
        """SELECT a.id, a.appointment_date, a.status, p.full_name AS patient_name, d.full_name AS doctor_name
           FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN doctors d ON d.id=a.doctor_id
           WHERE p.full_name LIKE %s OR d.full_name LIKE %s ORDER BY a.appointment_date DESC LIMIT %s""",
        (like, like, LIMIT),
    )
    return {
        "patients": patients, "doctors": doctors, "receptionists": receptionists,
        "clinics": clinics, "applications": applications, "appointments": appointments,
    }
