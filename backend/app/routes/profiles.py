from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth, hash_password
from app.utils.helpers import gen_code, add_audit

bp = Blueprint("profiles", __name__, url_prefix="/api")


@bp.get("/patients/profile")
@require_auth(["patient"])
def patient_profile():
    p = query(
        """SELECT p.*, u.email, u.phone, s.name AS state_name, c.name AS city_name, a.name AS area_name
           FROM patients p JOIN users u ON u.id = p.user_id
           LEFT JOIN states s ON s.id = p.state_id
           LEFT JOIN cities c ON c.id = p.city_id
           LEFT JOIN areas a ON a.id = p.area_id
           WHERE p.id=%s""",
        (g.profile_id,), fetchone=True,
    )
    return jsonify(p)


@bp.put("/patients/profile")
@require_auth(["patient"])
def update_patient_profile():
    data = request.get_json(force=True) or {}
    fields, params = [], []
    for f in ["full_name", "dob", "gender", "address", "state_id", "city_id", "area_id",
              "blood_group", "allergies", "emergency_contact"]:
        if f in data:
            fields.append(f"{f}=%s"); params.append(data[f])
    if fields:
        params.append(g.profile_id)
        execute(f"UPDATE patients SET {', '.join(fields)} WHERE id=%s", params)
    if "phone" in data:
        execute("UPDATE users SET phone=%s WHERE id=%s", (data["phone"], g.user_id))
    add_audit(g.user_id, "patient", "PROFILE_UPDATED")
    return jsonify({"message": "Profile updated"})


@bp.get("/doctors/profile")
@require_auth(["doctor"])
def doctor_profile():
    return jsonify(query("SELECT d.*, u.email, u.phone FROM doctors d JOIN users u ON u.id=d.user_id WHERE d.id=%s",
                          (g.profile_id,), fetchone=True))


@bp.put("/doctors/profile")
@require_auth(["doctor"])
def update_doctor_profile():
    data = request.get_json(force=True) or {}

    # Consultation fee is money and is the authoritative price used by billing,
    # so validate it before it ever reaches the UPDATE. Must be numeric and
    # non-negative; 0 is allowed (free consultation).
    if "consultation_fee" in data:
        raw = data["consultation_fee"]
        if raw is None or (isinstance(raw, str) and raw.strip() == ""):
            return jsonify({"error": "Consultation fee is required"}), 400
        try:
            fee = float(raw)
        except (TypeError, ValueError):
            return jsonify({"error": "Consultation fee must be a valid number"}), 400
        if fee != fee or fee in (float("inf"), float("-inf")):
            return jsonify({"error": "Consultation fee must be a valid number"}), 400
        if fee < 0:
            return jsonify({"error": "Consultation fee cannot be negative"}), 400
        if fee > 99999999.99:
            return jsonify({"error": "Consultation fee is too large"}), 400
        data["consultation_fee"] = round(fee, 2)

    fields, params = [], []
    for f in ["full_name", "specialization", "qualification", "experience_years",
              "consultation_fee", "appointment_duration_minutes", "bio"]:
        if f in data:
            fields.append(f"{f}=%s"); params.append(data[f])
    if fields:
        # g.profile_id is derived from the authenticated JWT, so a doctor can
        # only ever update their own row — never another doctor's fee.
        params.append(g.profile_id)
        execute(f"UPDATE doctors SET {', '.join(fields)} WHERE id=%s", params)
    if "consultation_fee" in data:
        add_audit(g.user_id, "doctor", "CONSULTATION_FEE_UPDATED", str(data["consultation_fee"]))
    return jsonify({"message": "Profile updated"})


@bp.get("/patients/<int:patient_id>/record")
@require_auth(["doctor", "receptionist"])
def patient_medical_record(patient_id):
    if g.role == "doctor":
        link = query(
            "SELECT id FROM appointments WHERE doctor_id=%s AND patient_id=%s LIMIT 1",
            (g.profile_id, patient_id), fetchone=True,
        )
        if not link:
            return jsonify({"error": "Forbidden: no authorized appointment with this patient"}), 403

    patient = query("SELECT * FROM patients WHERE id=%s", (patient_id,), fetchone=True)
    if not patient:
        return jsonify({"error": "Not found"}), 404
    return jsonify({
        "patient": patient,
        "vitals": query("SELECT * FROM vitals WHERE patient_id=%s ORDER BY recorded_at DESC", (patient_id,)),
        "diagnoses": query("SELECT * FROM diagnoses WHERE patient_id=%s ORDER BY created_at DESC", (patient_id,)),
        "prescriptions": query(
            "SELECT * FROM prescriptions WHERE patient_id=%s ORDER BY prescription_date DESC", (patient_id,)
        ),
        "appointments": query(
            "SELECT * FROM appointments WHERE patient_id=%s ORDER BY appointment_date DESC", (patient_id,)
        ),
        "vaccinations": query("SELECT * FROM vaccinations WHERE patient_id=%s", (patient_id,)),
        "followups": query("SELECT * FROM followups WHERE patient_id=%s", (patient_id,)),
        "documents": query(
            "SELECT id, doc_type, original_name, created_at FROM documents WHERE patient_id=%s", (patient_id,)
        ),
    })


@bp.post("/receptionist/patients")
@require_auth(["receptionist"])
def register_patient_by_receptionist():
    data = request.get_json(force=True) or {}
    required = ["full_name", "email", "mobile", "password"]
    if any(f not in data for f in required):
        return jsonify({"error": "Missing fields"}), 400
    existing = query("SELECT id FROM users WHERE email=%s", (data["email"],), fetchone=True)
    if existing:
        return jsonify({"error": "Email already registered"}), 409
    user_id = execute(
        "INSERT INTO users (role, email, phone, password_hash) VALUES ('patient', %s, %s, %s)",
        (data["email"], data["mobile"], hash_password(data["password"])),
    )
    patient_code = gen_code("PAT")
    patient_id = execute(
        """INSERT INTO patients (user_id, patient_code, full_name, dob, gender, address,
           state_id, city_id, area_id, blood_group, allergies, emergency_contact)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (user_id, patient_code, data["full_name"], data.get("dob"), data.get("gender"),
         data.get("address"), data.get("state_id"), data.get("city_id"), data.get("area_id"),
         data.get("blood_group"), data.get("allergies"), data.get("emergency_contact")),
    )
    add_audit(g.user_id, "receptionist", "PATIENT_REGISTERED", patient_code)
    return jsonify({"patient_id": patient_id, "patient_code": patient_code}), 201


@bp.get("/receptionist/patients")
@require_auth(["receptionist"])
def search_patients():
    search = request.args.get("search", "")
    return jsonify(query(
        """SELECT p.*, u.email, u.phone FROM patients p JOIN users u ON u.id=p.user_id
           WHERE p.full_name LIKE %s OR p.patient_code LIKE %s OR u.phone LIKE %s
           ORDER BY p.full_name LIMIT 50""",
        (f"%{search}%", f"%{search}%", f"%{search}%"),
    ))