import os

from flask import Blueprint, request, jsonify, g, current_app
from werkzeug.utils import secure_filename

from config import Config
from app.utils.db import query, execute
from app.utils.auth import require_auth, hash_password
from app.utils.helpers import add_audit, add_notification, gen_sequential_code, gen_temp_password
from app.services import application_timeline, duplicates, risk, alerts as alerts_service
from app.services.performance import compute_and_store_doctor_score
from app.services.capacity import snapshot_clinic_capacity

bp = Blueprint("admin", __name__, url_prefix="/api/admin")

ALLOWED_EXT = {"pdf", "png", "jpg", "jpeg"}
DOC_TYPES = {"degree_certificate", "medical_registration_certificate", "identity_proof", "additional_certificate", "profile_photo"}
ALLOWED_ORG_TYPES = {"clinic", "hospital", "diagnostic_center", "multi_speciality_hospital", "other"}


# =========================================================================
# Dashboard
# =========================================================================
@bp.get("/dashboard/stats")
@require_auth(["admin"])
def dashboard_stats():
    def count(sql, params=None):
        return query(sql, params, fetchone=True)["c"]

    stats = {
        "total_doctors": count("SELECT COUNT(*) c FROM doctors"),
        "total_clinics": count("SELECT COUNT(*) c FROM clinics WHERE org_type='clinic'"),
        "total_hospitals": count("SELECT COUNT(*) c FROM clinics WHERE org_type IN ('hospital','multi_speciality_hospital')"),
        "total_receptionists": count("SELECT COUNT(*) c FROM receptionists"),
        "total_patients": count("SELECT COUNT(*) c FROM patients"),
        "total_appointments": count("SELECT COUNT(*) c FROM appointments"),
        "pending_applications": count("SELECT COUNT(*) c FROM doctor_applications WHERE status IN ('PENDING','UNDER_REVIEW')"),
        "active_doctors": count("SELECT COUNT(*) c FROM doctors WHERE is_active=1 AND verification_status='APPROVED'"),
        "active_clinics": count("SELECT COUNT(*) c FROM clinics WHERE status='active' AND approval_status='APPROVED'"),
    }
    recent_doctors = query(
        "SELECT id, doctor_code, full_name, specialization, verification_status, created_at "
        "FROM doctors ORDER BY id DESC LIMIT 5"
    )
    pending_verifications = query(
        "SELECT id, full_name, clinic_name, status, created_at FROM doctor_applications "
        "WHERE status IN ('PENDING','UNDER_REVIEW') ORDER BY created_at DESC LIMIT 10"
    )
    recent_clinics = query(
        "SELECT id, clinic_code, name, org_type, approval_status, created_at FROM clinics "
        "WHERE approval_status='APPROVED' ORDER BY id DESC LIMIT 5"
    )
    recent_receptionists = query(
        "SELECT id, receptionist_code, full_name, clinic_id, created_at FROM receptionists ORDER BY id DESC LIMIT 5"
    )
    appt_stats = query(
        """SELECT status, COUNT(*) c FROM appointments GROUP BY status"""
    )
    clinic_stats = query(
        """SELECT org_type, COUNT(*) c FROM clinics GROUP BY org_type"""
    )
    return jsonify({
        "cards": stats,
        "recent_doctor_registrations": recent_doctors,
        "pending_verification_requests": pending_verifications,
        "recently_approved_clinics": recent_clinics,
        "recently_created_receptionists": recent_receptionists,
        "appointment_stats": appt_stats,
        "clinic_stats": clinic_stats,
    })


# =========================================================================
# Doctor + Clinic/Hospital Applications (registration & verification)
# =========================================================================
APPLICATION_FIELDS = [
    "full_name", "first_name", "middle_name", "last_name", "dob", "gender", "mobile", "email",
    "address", "state_id", "city_id", "area_id",
    "specialization", "qualification", "university", "registration_number", "registration_authority",
    "registration_year", "experience_years", "consultation_fee", "appointment_duration_minutes",
    "bio", "languages_known",
    "existing_clinic_id", "clinic_name", "org_type", "clinic_state_id", "clinic_city_id", "clinic_area_id",
    "clinic_address", "clinic_pincode", "map_location", "clinic_phone", "clinic_email",
    "clinic_emergency_contact", "clinic_website", "opening_time", "closing_time", "working_days",
    "emergency_service", "consultation_rooms", "beds", "facilities", "about",
]


@bp.get("/doctors/existing-organizations")
@require_auth(["admin"])
def doctor_existing_organizations():
    """
    Used by the "Add to existing organization" option on the New Doctor
    Application form. Identifies the doctor from the Doctor Information
    already entered (registered email first, then mobile — never by name
    alone, since names aren't unique) and returns only the Clinics/Hospitals
    that doctor is actually linked to via clinic_doctors. Never returns
    another doctor's organizations.
    """
    email = (request.args.get("email") or "").strip()
    mobile = (request.args.get("mobile") or "").strip()
    if not email and not mobile:
        return jsonify({"error": "email or mobile is required"}), 400

    doctor = None
    if email:
        doctor = query(
            """SELECT d.* FROM doctors d JOIN users u ON u.id = d.user_id
               WHERE u.email=%s AND u.role='doctor'""",
            (email,), fetchone=True,
        )
    if not doctor and mobile:
        doctor = query("SELECT * FROM doctors WHERE mobile=%s", (mobile,), fetchone=True)

    if not doctor:
        return jsonify({"doctor_found": False, "organizations": []})

    organizations = query(
        """SELECT c.id, c.clinic_code, c.name, c.org_type, c.address, c.pincode, c.map_location,
                  c.contact_number, c.emergency_contact, c.email, c.website,
                  c.opening_time, c.closing_time, c.working_days, c.emergency_service,
                  c.consultation_rooms, c.beds, c.facilities, c.about,
                  c.state_id, c.city_id, c.area_id,
                  s.name AS state_name, ci.name AS city_name, a.name AS area_name
           FROM clinic_doctors cd
           JOIN clinics c ON c.id = cd.clinic_id
           LEFT JOIN states s ON s.id = c.state_id
           LEFT JOIN cities ci ON ci.id = c.city_id
           LEFT JOIN areas a ON a.id = c.area_id
           WHERE cd.doctor_id=%s AND cd.status='active' AND c.status='active'
           ORDER BY c.name""",
        (doctor["id"],),
    )
    return jsonify({
        "doctor_found": True,
        "doctor_id": doctor["id"],
        "doctor_code": doctor["doctor_code"],
        "full_name": doctor["full_name"],
        "organizations": organizations,
    })


ORG_LOCATION_FIELDS = """
    c.id, c.clinic_code, c.name, c.org_type, c.address,
    c.state_id, c.city_id, c.area_id,
    s.name AS state_name, ci.name AS city_name, a.name AS area_name
"""


@bp.get("/clinics/available")
@require_auth(["admin"])
def available_clinics():
    """
    Used by the "Add to existing organization" option on the New Doctor
    Application form. Unlike /doctors/existing-organizations (which returns
    only the organizations a specific, already-onboarded doctor is linked
    to), this returns every active, approved clinic/hospital in the
    doctor's geographic area — since the whole point of this flow is to
    attach a brand new doctor application to an organization they aren't
    linked to yet.

    Geographic filtering priority:
      1. area_id, if provided
      2. city_id, if area_id is not provided
    At least one of area_id/city_id is required; without either we refuse
    to return an unrestricted list of every organization on the platform.
    """
    area_id = (request.args.get("area_id") or "").strip()
    city_id = (request.args.get("city_id") or "").strip()

    if not area_id and not city_id:
        return jsonify({"organizations": [], "filtered_by": None})

    if area_id:
        organizations = query(
            f"""SELECT {ORG_LOCATION_FIELDS}
                FROM clinics c
                LEFT JOIN states s ON s.id = c.state_id
                LEFT JOIN cities ci ON ci.id = c.city_id
                LEFT JOIN areas a ON a.id = c.area_id
                WHERE c.status='active' AND c.approval_status='APPROVED' AND c.area_id=%s
                ORDER BY c.name""",
            (area_id,),
        )
        filtered_by = "area"
    else:
        organizations = query(
            f"""SELECT {ORG_LOCATION_FIELDS}
                FROM clinics c
                LEFT JOIN states s ON s.id = c.state_id
                LEFT JOIN cities ci ON ci.id = c.city_id
                LEFT JOIN areas a ON a.id = c.area_id
                WHERE c.status='active' AND c.approval_status='APPROVED' AND c.city_id=%s
                ORDER BY c.name""",
            (city_id,),
        )
        filtered_by = "city"

    organizations = [o for o in organizations if o["org_type"] in ALLOWED_ORG_TYPES]
    return jsonify({"organizations": organizations, "filtered_by": filtered_by})


@bp.post("/applications")
@require_auth(["admin"])
def create_application():
    """
    Admin creates a combined Doctor + Clinic/Hospital application.
    Accepts multipart/form-data so verification documents can be attached
    (degree certificate, medical registration certificate, identity proof,
    additional certificate, profile photo). Status starts PENDING.
    """
    data = request.form if request.files or request.form else (request.get_json(force=True) or {})
    if not data.get("full_name") or not data.get("email"):
        return jsonify({"error": "Doctor full_name and email are required"}), 400
    if not data.get("existing_clinic_id") and not data.get("clinic_name"):
        return jsonify({"error": "Either existing_clinic_id or a new clinic_name is required"}), 400

    # "Add to existing organization" must never let the frontend hand over an
    # arbitrary clinic_id — regardless of what the dropdown showed, the
    # backend re-validates that the clinic exists, is active/approved, is an
    # allowed organization type, and actually sits in the doctor's declared
    # geographic area (falling back to city when no area was given). This
    # is what stops a tampered request from linking the application to an
    # unrelated organization even if the API is called directly. Note this
    # flow onboards a brand-new doctor application, so — unlike the old
    # behaviour — the doctor is not required to already have an account or
    # an existing link to the clinic.
    if data.get("existing_clinic_id"):
        clinic = query(
            "SELECT id, status, approval_status, org_type, area_id, city_id FROM clinics WHERE id=%s",
            (data.get("existing_clinic_id"),), fetchone=True,
        )
        if not clinic or clinic["status"] != "active" or clinic["approval_status"] != "APPROVED":
            return jsonify({"error": "The selected organization is no longer available."}), 400
        if clinic["org_type"] not in ALLOWED_ORG_TYPES:
            return jsonify({"error": "The selected organization type is not allowed."}), 400

        doctor_area_id = (data.get("area_id") or "").strip() if isinstance(data.get("area_id"), str) else data.get("area_id")
        doctor_city_id = (data.get("city_id") or "").strip() if isinstance(data.get("city_id"), str) else data.get("city_id")

        if doctor_area_id:
            if str(clinic["area_id"]) != str(doctor_area_id):
                return jsonify({"error": "The selected organization does not match the doctor's area."}), 400
        elif doctor_city_id:
            if str(clinic["city_id"]) != str(doctor_city_id):
                return jsonify({"error": "The selected organization does not match the doctor's city."}), 400
        else:
            return jsonify({"error": "The doctor's city or area is required to select an existing organization."}), 400

    values = {f: data.get(f) or None for f in APPLICATION_FIELDS}
    values["emergency_service"] = 1 if str(values.get("emergency_service")) in ("1", "true", "True", "on") else 0

    columns = ", ".join(values.keys())
    placeholders = ", ".join(["%s"] * len(values))
    app_id = execute(
        f"INSERT INTO doctor_applications ({columns}, status, created_by_admin_id) "
        f"VALUES ({placeholders}, 'PENDING', %s)",
        (*values.values(), g.user_id),
    )

    _save_application_documents(app_id)

    application_timeline.add_event(app_id, "SUBMITTED", g.user_id, "Application submitted by admin")
    has_documents = query(
        "SELECT COUNT(*) c FROM doctor_documents WHERE application_id=%s", (app_id,), fetchone=True
    )["c"] > 0
    if has_documents:
        application_timeline.add_event(app_id, "DOCUMENTS_UPLOADED", g.user_id)

    # Duplicate-detection and risk-scoring never block application creation —
    # they are advisory signals surfaced to the admin during review, computed
    # best-effort so an unrelated failure here can't prevent onboarding.
    try:
        duplicates.run_and_store_detection(
            application_id=app_id, full_name=values.get("full_name"), mobile=values.get("mobile"),
            email=values.get("email"), registration_number=values.get("registration_number"),
            dob=values.get("dob"),
        )
    except Exception:
        pass
    try:
        risk.compute_and_store_risk(app_id)
    except Exception:
        pass

    add_audit(g.user_id, "admin", "APPLICATION_CREATED", f"Application #{app_id}")
    return jsonify({"application_id": app_id, "status": "PENDING"}), 201


def _save_application_documents(app_id):
    for doc_type in DOC_TYPES:
        file = request.files.get(doc_type)
        if not file or not file.filename:
            continue
        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in ALLOWED_EXT:
            continue
        upload_dir = os.path.join(current_app.root_path, "..", Config.UPLOAD_FOLDER, "doctor_documents")
        os.makedirs(upload_dir, exist_ok=True)
        safe_name = secure_filename(f"app{app_id}_{doc_type}_{file.filename}")
        file.save(os.path.join(upload_dir, safe_name))
        execute(
            "INSERT INTO doctor_documents (application_id, doc_type, file_path, original_name) VALUES (%s,%s,%s,%s)",
            (app_id, doc_type, f"doctor_documents/{safe_name}", file.filename),
        )


@bp.get("/applications")
@require_auth(["admin"])
def list_applications():
    status = request.args.get("status")
    sql = "SELECT * FROM doctor_applications WHERE 1=1"
    params = []
    if status:
        sql += " AND status=%s"; params.append(status)
    sql += " ORDER BY created_at DESC"
    return jsonify(query(sql, params))


@bp.get("/applications/<int:app_id>")
@require_auth(["admin"])
def get_application(app_id):
    application = query("SELECT * FROM doctor_applications WHERE id=%s", (app_id,), fetchone=True)
    if not application:
        return jsonify({"error": "Application not found"}), 404
    application["documents"] = query(
        "SELECT id, doc_type, file_path, original_name, uploaded_at FROM doctor_documents WHERE application_id=%s",
        (app_id,),
    )
    return jsonify(application)


@bp.post("/applications/<int:app_id>/approve")
@require_auth(["admin"])
def approve_application(app_id):
    """
    Approves a pending application:
      1. Creates/reuses the clinic/hospital record (generates CLN-/HOS- code if new)
      2. Creates the doctor's user + doctor record (generates DOC- code)
      3. Links doctor <-> clinic in clinic_doctors
      4. Generates a temporary password (hashed, never stored in plaintext)
      5. Returns the credentials once, for the admin to hand to the doctor
    """
    application = query("SELECT * FROM doctor_applications WHERE id=%s", (app_id,), fetchone=True)
    if not application:
        return jsonify({"error": "Application not found"}), 404
    if application["status"] == "APPROVED":
        return jsonify({"error": "Application already approved"}), 409

    # ---- 1. Clinic/Hospital ----
    if application["existing_clinic_id"]:
        clinic = query("SELECT * FROM clinics WHERE id=%s", (application["existing_clinic_id"],), fetchone=True)
        if not clinic:
            return jsonify({"error": "Linked clinic/hospital no longer exists"}), 400
        clinic_id = clinic["id"]
    else:
        org_type = application["org_type"] or "clinic"
        prefix = "HOS" if org_type in ("hospital", "multi_speciality_hospital") else "CLN"
        clinic_code = gen_sequential_code(prefix)
        clinic_id = execute(
            """INSERT INTO clinics
               (clinic_code, name, type, org_type, address, pincode, map_location,
                state_id, city_id, area_id, contact_number, emergency_contact, email, website,
                opening_time, closing_time, working_days, emergency_service, consultation_rooms, beds,
                facilities, about, status, approval_status, created_by_admin_id, approved_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                       'active','APPROVED',%s,NOW())""",
            (
                clinic_code, application["clinic_name"],
                "hospital" if "hospital" in org_type else ("diagnostic_center" if org_type == "diagnostic_center" else "clinic"),
                org_type, application["clinic_address"], application["clinic_pincode"], application["map_location"],
                application["clinic_state_id"], application["clinic_city_id"], application["clinic_area_id"],
                application["clinic_phone"], application["clinic_emergency_contact"], application["clinic_email"],
                application["clinic_website"], application["opening_time"], application["closing_time"],
                application["working_days"], application["emergency_service"], application["consultation_rooms"],
                application["beds"], application["facilities"], application["about"], g.user_id,
            ),
        )

    # ---- 2. Doctor user + profile ----
    existing_user = query(
        "SELECT id FROM users WHERE email=%s AND role='doctor'", (application["email"],), fetchone=True
    )
    temp_password = gen_temp_password()
    if existing_user:
        # Doctor already has a login (e.g. being added to a 2nd clinic) — reuse it, don't reset password.
        user_id = existing_user["id"]
        doctor = query("SELECT * FROM doctors WHERE user_id=%s", (user_id,), fetchone=True)
        if not doctor:
            return jsonify({
                "error": "A user with this email exists but has no doctor profile. "
                         "Resolve the conflict before approving."
            }), 409
        credentials_password_note = "existing account reused — password unchanged"
    else:
        email_conflict = query(
            "SELECT id, role FROM users WHERE email=%s", (application["email"],), fetchone=True
        )
        if email_conflict:
            return jsonify({
                "error": f"Email {application['email']} is already registered as a "
                         f"{email_conflict['role']} account. Resolve the conflict before approving."
            }), 409
        user_id = execute(
            "INSERT INTO users (role, email, phone, password_hash) VALUES ('doctor', %s, %s, %s)",
            (application["email"], application["mobile"], hash_password(temp_password)),
        )
        doctor_code = gen_sequential_code("DOC")
        doctor_id = execute(
            """INSERT INTO doctors
               (user_id, doctor_code, full_name, first_name, middle_name, last_name, dob, gender, mobile,
                address, state_id, city_id, area_id, specialization, qualification, university,
                registration_number, registration_authority, registration_year, experience_years,
                consultation_fee, appointment_duration_minutes, bio, languages_known,
                verification_status, is_active, created_by_admin_id, approved_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                       'APPROVED',1,%s,NOW())""",
            (
                user_id, doctor_code, application["full_name"], application["first_name"], application["middle_name"],
                application["last_name"], application["dob"], application["gender"], application["mobile"],
                application["address"], application["state_id"], application["city_id"], application["area_id"],
                application["specialization"], application["qualification"], application["university"],
                application["registration_number"], application["registration_authority"], application["registration_year"],
                application["experience_years"] or 0, application["consultation_fee"] or 0,
                application["appointment_duration_minutes"] or 15, application["bio"], application["languages_known"],
                g.user_id,
            ),
        )
        doctor = query("SELECT * FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
        credentials_password_note = None

    # Move any uploaded documents from the application onto the doctor's permanent record.
    execute("UPDATE doctor_documents SET doctor_id=%s WHERE application_id=%s", (doctor["id"], app_id))

    # ---- 3. Link doctor <-> clinic (many-to-many; ignore if link already exists) ----
    already_linked = query(
        "SELECT id FROM clinic_doctors WHERE clinic_id=%s AND doctor_id=%s", (clinic_id, doctor["id"]), fetchone=True
    )
    if not already_linked:
        execute(
            "INSERT INTO clinic_doctors (clinic_id, doctor_id, status) VALUES (%s,%s,'active')",
            (clinic_id, doctor["id"]),
        )

    clinic = query("SELECT * FROM clinics WHERE id=%s", (clinic_id,), fetchone=True)

    execute(
        "UPDATE doctor_applications SET status='APPROVED', reviewed_by_admin_id=%s, reviewed_at=NOW(), "
        "resulting_doctor_id=%s, resulting_clinic_id=%s WHERE id=%s",
        (g.user_id, doctor["id"], clinic_id, app_id),
    )

    add_notification(
        user_id, "application_approved", "Application Approved",
        f"Your application has been approved.\nDoctor ID: {doctor['doctor_code']}\n"
        f"Clinic/Hospital ID: {clinic['clinic_code']} ({clinic['name']})",
    )
    add_audit(g.user_id, "admin", "APPLICATION_APPROVED", f"Application #{app_id} -> Doctor {doctor['doctor_code']}")

    # ---- Timeline, badges, alerts, initial scoring (best-effort; approval
    # itself has already committed above and must not be undone by these) ----
    try:
        application_timeline.add_event(app_id, "ADMIN_REVIEW", g.user_id)
        application_timeline.add_event(app_id, "DOCUMENTS_VERIFIED", g.user_id,
                                        "Documents reviewed as part of approval")
        application_timeline.add_event(app_id, "ORGANIZATION_ASSIGNED", g.user_id,
                                        f"Assigned to {clinic['name']}")
        application_timeline.add_event(app_id, "APPROVED", g.user_id)
        application_timeline.add_event(app_id, "DOCTOR_ACTIVE", g.user_id,
                                        "Doctor account activated")
    except Exception:
        pass
    try:
        for badge_type in ("VERIFIED_DOCTOR", "DOCUMENTS_VERIFIED", "ORGANIZATION_VERIFIED", "PROFILE_VERIFIED"):
            execute(
                """INSERT INTO doctor_verification_badges (doctor_id, badge_type, granted_by_admin_id)
                   VALUES (%s,%s,%s)
                   ON DUPLICATE KEY UPDATE is_granted=1, granted_by_admin_id=%s, granted_at=NOW(), revoked_at=NULL""",
                (doctor["id"], badge_type, g.user_id, g.user_id),
            )
        add_audit(g.user_id, "admin", "DOCTOR_VERIFICATION_CHANGED", f"Badges granted for {doctor['doctor_code']}")
    except Exception:
        pass
    try:
        alerts_service.resolve_by_entity("APPLICATION", app_id, g.user_id)
        compute_and_store_doctor_score(doctor["id"])
        snapshot_clinic_capacity(clinic_id)
    except Exception:
        pass

    response = {
        "doctor_id": doctor["doctor_code"],
        "clinic_id": clinic["clinic_code"],
        "clinic_name": clinic["name"],
    }
    if credentials_password_note:
        response["note"] = credentials_password_note
    else:
        response["temporary_password"] = temp_password
    return jsonify(response)


@bp.post("/applications/<int:app_id>/reject")
@require_auth(["admin"])
def reject_application(app_id):
    data = request.get_json(force=True) or {}
    reason = data.get("reason", "")
    application = query("SELECT * FROM doctor_applications WHERE id=%s", (app_id,), fetchone=True)
    if not application:
        return jsonify({"error": "Application not found"}), 404
    execute(
        "UPDATE doctor_applications SET status='REJECTED', rejection_reason=%s, "
        "reviewed_by_admin_id=%s, reviewed_at=NOW() WHERE id=%s",
        (reason, g.user_id, app_id),
    )
    add_audit(g.user_id, "admin", "APPLICATION_REJECTED", f"Application #{app_id}: {reason}")
    try:
        application_timeline.add_event(app_id, "REJECTED", g.user_id, reason)
        alerts_service.resolve_by_entity("APPLICATION", app_id, g.user_id)
    except Exception:
        pass
    return jsonify({"status": "REJECTED"})


@bp.post("/applications/<int:app_id>/note")
@require_auth(["admin"])
def add_application_note(app_id):
    data = request.get_json(force=True) or {}
    execute(
        "UPDATE doctor_applications SET admin_note=%s, status=IF(status='PENDING','UNDER_REVIEW',status) WHERE id=%s",
        (data.get("note", ""), app_id),
    )
    return jsonify({"message": "Note saved"})


# =========================================================================
# Doctor management
# =========================================================================
@bp.get("/doctors")
@require_auth(["admin"])
def list_doctors():
    search = request.args.get("search")
    specialization = request.args.get("specialization")
    state_id = request.args.get("state_id")
    city_id = request.args.get("city_id")

    sql = "SELECT * FROM doctors WHERE 1=1"
    params = []
    if search:
        sql += " AND (full_name LIKE %s OR doctor_code LIKE %s)"; params += [f"%{search}%", f"%{search}%"]
    if specialization:
        sql += " AND specialization=%s"; params.append(specialization)
    if state_id:
        sql += " AND state_id=%s"; params.append(state_id)
    if city_id:
        sql += " AND city_id=%s"; params.append(city_id)
    sql += " ORDER BY id DESC"
    doctors = query(sql, params)
    for d in doctors:
        d["clinics"] = query(
            """SELECT c.id, c.clinic_code, c.name, cd.status FROM clinic_doctors cd
               JOIN clinics c ON c.id = cd.clinic_id WHERE cd.doctor_id=%s""",
            (d["id"],),
        )
    return jsonify(doctors)


@bp.get("/doctors/<int:doctor_id>")
@require_auth(["admin"])
def get_doctor_admin(doctor_id):
    doctor = query("SELECT * FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404
    doctor["clinics"] = query(
        """SELECT c.id, c.clinic_code, c.name, cd.status FROM clinic_doctors cd
           JOIN clinics c ON c.id = cd.clinic_id WHERE cd.doctor_id=%s""",
        (doctor_id,),
    )
    doctor["documents"] = query("SELECT * FROM doctor_documents WHERE doctor_id=%s", (doctor_id,))
    return jsonify(doctor)


@bp.post("/doctors/<int:doctor_id>/status")
@require_auth(["admin"])
def set_doctor_status(doctor_id):
    data = request.get_json(force=True) or {}
    is_active = 1 if data.get("is_active") else 0
    execute("UPDATE doctors SET is_active=%s WHERE id=%s", (is_active, doctor_id))
    add_audit(g.user_id, "admin", "DOCTOR_STATUS_CHANGED", f"Doctor #{doctor_id} active={is_active}")
    return jsonify({"message": "Updated"})


@bp.post("/doctors/<int:doctor_id>/clinics")
@require_auth(["admin"])
def add_doctor_clinic(doctor_id):
    data = request.get_json(force=True) or {}
    clinic_id = data.get("clinic_id")
    if not clinic_id:
        return jsonify({"error": "clinic_id is required"}), 400
    existing = query("SELECT id FROM clinic_doctors WHERE doctor_id=%s AND clinic_id=%s", (doctor_id, clinic_id), fetchone=True)
    if existing:
        execute("UPDATE clinic_doctors SET status='active' WHERE id=%s", (existing["id"],))
    else:
        execute("INSERT INTO clinic_doctors (doctor_id, clinic_id, status) VALUES (%s,%s,'active')", (doctor_id, clinic_id))
    add_audit(g.user_id, "admin", "DOCTOR_CLINIC_LINKED", f"Doctor #{doctor_id} -> Clinic #{clinic_id}")
    return jsonify({"message": "Linked"})


@bp.delete("/doctors/<int:doctor_id>/clinics/<int:clinic_id>")
@require_auth(["admin"])
def remove_doctor_clinic(doctor_id, clinic_id):
    execute("UPDATE clinic_doctors SET status='inactive' WHERE doctor_id=%s AND clinic_id=%s", (doctor_id, clinic_id))
    add_audit(g.user_id, "admin", "DOCTOR_CLINIC_UNLINKED", f"Doctor #{doctor_id} x Clinic #{clinic_id}")
    return jsonify({"message": "Removed"})


@bp.post("/doctors/<int:doctor_id>/reset-password")
@require_auth(["admin"])
def reset_doctor_password(doctor_id):
    doctor = query("SELECT * FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404
    temp_password = gen_temp_password()
    execute("UPDATE users SET password_hash=%s WHERE id=%s", (hash_password(temp_password), doctor["user_id"]))
    add_notification(doctor["user_id"], "password_reset", "Password Reset", "Your password was reset by an administrator.")
    add_audit(g.user_id, "admin", "DOCTOR_PASSWORD_RESET", f"Doctor #{doctor_id}")
    return jsonify({"temporary_password": temp_password})


# =========================================================================
# Clinic / Hospital management
# =========================================================================
@bp.get("/clinics")
@require_auth(["admin"])
def list_clinics_admin():
    search = request.args.get("search")
    state_id = request.args.get("state_id")
    city_id = request.args.get("city_id")
    org_type = request.args.get("org_type")

    sql = "SELECT * FROM clinics WHERE 1=1"
    params = []
    if search:
        sql += " AND (name LIKE %s OR clinic_code LIKE %s)"; params += [f"%{search}%", f"%{search}%"]
    if state_id:
        sql += " AND state_id=%s"; params.append(state_id)
    if city_id:
        sql += " AND city_id=%s"; params.append(city_id)
    if org_type:
        sql += " AND org_type=%s"; params.append(org_type)
    sql += " ORDER BY id DESC"
    return jsonify(query(sql, params))


@bp.get("/clinics/<int:clinic_id>")
@require_auth(["admin"])
def get_clinic_admin(clinic_id):
    clinic = query("SELECT * FROM clinics WHERE id=%s", (clinic_id,), fetchone=True)
    if not clinic:
        return jsonify({"error": "Not found"}), 404
    clinic["doctors"] = query(
        """SELECT d.id, d.doctor_code, d.full_name, cd.status FROM clinic_doctors cd
           JOIN doctors d ON d.id = cd.doctor_id WHERE cd.clinic_id=%s""",
        (clinic_id,),
    )
    clinic["receptionists"] = query(
        "SELECT id, receptionist_code, full_name, is_active FROM receptionists WHERE clinic_id=%s", (clinic_id,)
    )
    return jsonify(clinic)


@bp.post("/clinics/<int:clinic_id>/status")
@require_auth(["admin"])
def set_clinic_status(clinic_id):
    data = request.get_json(force=True) or {}
    status = data.get("status")
    if status not in ("active", "inactive"):
        return jsonify({"error": "status must be 'active' or 'inactive'"}), 400
    execute("UPDATE clinics SET status=%s WHERE id=%s", (status, clinic_id))
    add_audit(g.user_id, "admin", "CLINIC_STATUS_CHANGED", f"Clinic #{clinic_id} -> {status}")
    return jsonify({"message": "Updated"})


@bp.post("/clinics/<int:clinic_id>/approval")
@require_auth(["admin"])
def set_clinic_approval(clinic_id):
    data = request.get_json(force=True) or {}
    decision = data.get("decision")
    if decision not in ("APPROVED", "REJECTED"):
        return jsonify({"error": "decision must be APPROVED or REJECTED"}), 400
    if decision == "APPROVED":
        execute("UPDATE clinics SET approval_status='APPROVED', approved_at=NOW() WHERE id=%s", (clinic_id,))
    else:
        execute(
            "UPDATE clinics SET approval_status='REJECTED', rejection_reason=%s WHERE id=%s",
            (data.get("reason", ""), clinic_id),
        )
    add_audit(g.user_id, "admin", "CLINIC_APPROVAL", f"Clinic #{clinic_id} -> {decision}")
    return jsonify({"message": "Updated"})


# =========================================================================
# Receptionist management
# =========================================================================
@bp.get("/receptionists")
@require_auth(["admin"])
def list_receptionists_admin():
    search = request.args.get("search")
    clinic_id = request.args.get("clinic_id")
    sql = """SELECT r.*, c.clinic_code, c.name AS clinic_name, d.doctor_code, d.full_name AS doctor_name
             FROM receptionists r
             LEFT JOIN clinics c ON c.id = r.clinic_id
             LEFT JOIN doctors d ON d.id = r.added_by_doctor_id
             WHERE 1=1"""
    params = []
    if search:
        sql += " AND (r.full_name LIKE %s OR r.receptionist_code LIKE %s)"; params += [f"%{search}%", f"%{search}%"]
    if clinic_id:
        sql += " AND r.clinic_id=%s"; params.append(clinic_id)
    sql += " ORDER BY r.id DESC"
    return jsonify(query(sql, params))


@bp.post("/receptionists/<int:rec_id>/status")
@require_auth(["admin"])
def set_receptionist_status(rec_id):
    data = request.get_json(force=True) or {}
    is_active = 1 if data.get("is_active") else 0
    execute("UPDATE receptionists SET is_active=%s WHERE id=%s", (is_active, rec_id))
    add_audit(g.user_id, "admin", "RECEPTIONIST_STATUS_CHANGED", f"Receptionist #{rec_id} active={is_active}")
    return jsonify({"message": "Updated"})


@bp.post("/receptionists/<int:rec_id>/reset-password")
@require_auth(["admin"])
def reset_receptionist_password(rec_id):
    rec = query("SELECT * FROM receptionists WHERE id=%s", (rec_id,), fetchone=True)
    if not rec:
        return jsonify({"error": "Receptionist not found"}), 404
    temp_password = gen_temp_password()
    execute("UPDATE users SET password_hash=%s WHERE id=%s", (hash_password(temp_password), rec["user_id"]))
    add_notification(rec["user_id"], "password_reset", "Password Reset", "Your password was reset by an administrator.")
    add_audit(g.user_id, "admin", "RECEPTIONIST_PASSWORD_RESET", f"Receptionist #{rec_id}")
    return jsonify({"temporary_password": temp_password})


# =========================================================================
# Read-only Patients / Appointments views (platform-wide, for oversight)
# =========================================================================
@bp.get("/documents/<int:doc_id>/download")
@require_auth(["admin"])
def download_document(doc_id):
    """Admin-only, authenticated document download (degree/registration/ID proofs etc.)."""
    from flask import send_from_directory
    doc = query("SELECT * FROM doctor_documents WHERE id=%s", (doc_id,), fetchone=True)
    if not doc:
        return jsonify({"error": "Not found"}), 404
    upload_root = os.path.join(current_app.root_path, "..", Config.UPLOAD_FOLDER)
    directory, filename = os.path.split(doc["file_path"])
    return send_from_directory(os.path.join(upload_root, directory), filename, as_attachment=False)
@require_auth(["admin"])
def list_patients_admin():
    search = request.args.get("search")
    sql = "SELECT id, patient_code, full_name, dob, gender, created_at FROM patients WHERE 1=1"
    params = []
    if search:
        sql += " AND (full_name LIKE %s OR patient_code LIKE %s)"; params += [f"%{search}%", f"%{search}%"]
    sql += " ORDER BY id DESC LIMIT 200"
    return jsonify(query(sql, params))


@bp.get("/appointments")
@require_auth(["admin"])
def list_appointments_admin():
    clinic_id = request.args.get("clinic_id")
    sql = """SELECT a.id, a.appointment_date, a.appointment_time, a.status,
                    p.full_name AS patient_name, d.full_name AS doctor_name, c.name AS clinic_name
             FROM appointments a
             JOIN patients p ON p.id = a.patient_id
             JOIN doctors d ON d.id = a.doctor_id
             JOIN clinics c ON c.id = a.clinic_id
             WHERE 1=1"""
    params = []
    if clinic_id:
        sql += " AND a.clinic_id=%s"; params.append(clinic_id)
    sql += " ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT 200"
    return jsonify(query(sql, params))