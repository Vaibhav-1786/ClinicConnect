import datetime
import secrets

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import hash_password, verify_password, issue_token, require_auth
from app.utils.helpers import gen_code, add_audit
from app.services.google_auth import verify_google_credential, GoogleTokenError
from app.services.mailer import (
    send_password_reset_email,
    send_doctor_id_email,
    send_receptionist_id_email,
    send_clinic_id_email,
)
from app.routes.two_factor import is_2fa_enabled, start_otp_challenge
from config import Config

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


# ---------------- Patient ----------------
@bp.post("/patient/register")
def patient_register():
    data = request.get_json(force=True) or {}
    required = ["full_name", "email", "password", "mobile"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    existing = query("SELECT id FROM users WHERE email=%s", (data["email"],), fetchone=True)
    if existing:
        return jsonify({"error": "Email already registered"}), 409

    user_id = execute(
        "INSERT INTO users (role, email, phone, password_hash) VALUES ('patient', %s, %s, %s)",
        (data["email"], data.get("mobile"), hash_password(data["password"])),
    )
    patient_code = gen_code("PAT")
    patient_id = execute(
        """INSERT INTO patients
           (user_id, patient_code, full_name, dob, gender, address, state_id, city_id, area_id,
            blood_group, allergies, emergency_contact)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (
            user_id, patient_code, data["full_name"], data.get("dob"), data.get("gender"),
            data.get("address"), data.get("state_id"), data.get("city_id"), data.get("area_id"),
            data.get("blood_group"), data.get("allergies"), data.get("emergency_contact"),
        ),
    )
    add_audit(user_id, "patient", "REGISTER", f"Patient {patient_code} registered")
    token = issue_token(user_id, "patient", {"profile_id": patient_id})
    return jsonify({"token": token, "patient_id": patient_id, "patient_code": patient_code}), 201


@bp.post("/patient/login")
def patient_login():
    data = request.get_json(force=True) or {}
    user = query("SELECT * FROM users WHERE email=%s AND role='patient'", (data.get("email"),), fetchone=True)
    if not user or not verify_password(data.get("password", ""), user["password_hash"]):
        return jsonify({"error": "Invalid credentials"}), 401
    if not user["is_active"]:
        return jsonify({"error": "Account disabled"}), 403
    patient = query("SELECT id, patient_code, full_name, city_id FROM patients WHERE user_id=%s", (user["id"],), fetchone=True)

    # Optional city/location picked on the login form. If provided and it
    # differs from what's on file, treat it the same as a profile update:
    # only this patient's row changes (see profiles.py for the equivalent
    # explicit "change location" path from the profile page).
    city_id = data.get("city_id")
    if city_id:
        city = query("SELECT id FROM cities WHERE id=%s", (city_id,), fetchone=True)
        if not city:
            return jsonify({"error": "Invalid city selected"}), 400
        if city_id != patient.get("city_id"):
            execute("UPDATE patients SET city_id=%s WHERE id=%s", (city_id, patient["id"]))
            add_audit(user["id"], "patient", "LOCATION_CHANGED_AT_LOGIN", f"-> city {city_id}")
        patient["city_id"] = city_id

    if is_2fa_enabled(user["id"]):
        return jsonify(start_otp_challenge(user["id"], "patient", {"profile_id": patient["id"]}, {"patient": patient}))
    token = issue_token(user["id"], "patient", {"profile_id": patient["id"]})
    add_audit(user["id"], "patient", "LOGIN")
    return jsonify({"token": token, "patient": patient})


@bp.post("/google")
def patient_google_login():
    """
    "Continue with Google" — patients only.

    The frontend sends only the opaque Google ID token it received from
    Google's Identity Services library. We verify it server-side, then
    either log in the matching patient or create a brand-new patient
    account from the verified Google profile. This can never create or
    log in a doctor, receptionist, or admin account — the role is always
    hard-coded to 'patient' below.
    """
    data = request.get_json(force=True) or {}
    credential = data.get("credential") or data.get("token") or data.get("id_token")

    try:
        info = verify_google_credential(credential)
    except GoogleTokenError as e:
        return jsonify({"error": str(e)}), 401

    google_id = info["google_id"]
    email = info["email"]
    full_name = info["full_name"]

    # 1) Already linked to this exact Google account.
    user = query("SELECT * FROM users WHERE google_id=%s AND role='patient'", (google_id,), fetchone=True)

    # 2) Not linked yet, but a patient account already exists with this
    #    verified email — link the two instead of creating a duplicate.
    if not user:
        existing_by_email = query("SELECT * FROM users WHERE email=%s", (email,), fetchone=True)
        if existing_by_email:
            if existing_by_email["role"] != "patient":
                # Never let Google login touch a doctor/receptionist/admin account.
                return jsonify({"error": "This email is already registered for a different account type"}), 409
            execute("UPDATE users SET google_id=%s WHERE id=%s", (google_id, existing_by_email["id"]))
            user = existing_by_email

    # 3) Brand-new patient — register them using the verified Google profile.
    if not user:
        # Accounts created via Google have no usable password; store an
        # unguessable random hash so password_hash's NOT NULL constraint is
        # satisfied without ever creating a valid credential for it.
        placeholder_hash = hash_password(_secrets_token())
        user_id = execute(
            "INSERT INTO users (role, email, google_id, password_hash) VALUES ('patient', %s, %s, %s)",
            (email, google_id, placeholder_hash),
        )
        patient_code = gen_code("PAT")
        execute(
            "INSERT INTO patients (user_id, patient_code, full_name) VALUES (%s, %s, %s)",
            (user_id, patient_code, full_name),
        )
        user = query("SELECT * FROM users WHERE id=%s", (user_id,), fetchone=True)
        add_audit(user_id, "patient", "REGISTER_GOOGLE", f"Patient {patient_code} registered via Google")

    if not user["is_active"]:
        return jsonify({"error": "Account disabled"}), 403

    patient = query("SELECT id, patient_code, full_name FROM patients WHERE user_id=%s", (user["id"],), fetchone=True)
    if is_2fa_enabled(user["id"]):
        return jsonify(start_otp_challenge(user["id"], "patient", {"profile_id": patient["id"]}, {"patient": patient}))
    token = issue_token(user["id"], "patient", {"profile_id": patient["id"]})
    add_audit(user["id"], "patient", "LOGIN_GOOGLE")
    return jsonify({"token": token, "patient": patient})


def _secrets_token():
    return secrets.token_urlsafe(48)


# ---------------- Receptionist ----------------
@bp.post("/receptionist/login")
def receptionist_login():
    """
    Receptionist Login = Receptionist ID + Clinic/Hospital ID + Password.
    Every check (existence, active flags, org membership, password) happens
    here in the backend — the frontend never decides whether a login is valid.
    """
    data = request.get_json(force=True) or {}
    receptionist_code = (data.get("receptionist_id") or data.get("receptionist_code") or "").strip()
    clinic_code = (data.get("clinic_id") or data.get("clinic_code") or "").strip()
    password = data.get("password", "")

    if not receptionist_code or not clinic_code or not password:
        return jsonify({"error": "Receptionist ID, Clinic/Hospital ID and Password are required"}), 400

    rec = query(
        "SELECT * FROM receptionists WHERE receptionist_code=%s", (receptionist_code,), fetchone=True
    )
    if not rec:
        return jsonify({"error": "Invalid Receptionist ID, Clinic/Hospital ID or Password"}), 401

    user = query("SELECT * FROM users WHERE id=%s AND role='receptionist'", (rec["user_id"],), fetchone=True)
    if not user or not verify_password(password, user["password_hash"]):
        return jsonify({"error": "Invalid Receptionist ID, Clinic/Hospital ID or Password"}), 401
    if not user["is_active"] or not rec["is_active"]:
        return jsonify({"error": "This receptionist account has been deactivated"}), 403

    clinic = query(
        "SELECT * FROM clinics WHERE clinic_code=%s", (clinic_code,), fetchone=True
    )
    if not clinic or clinic["status"] != "active" or clinic["approval_status"] != "APPROVED":
        return jsonify({"error": "Invalid Receptionist ID, Clinic/Hospital ID or Password"}), 401

    # Enforce that this receptionist actually belongs to the clinic they typed in.
    if rec["clinic_id"] != clinic["id"]:
        return jsonify({"error": "This receptionist is not associated with the given Clinic/Hospital ID"}), 403

    receptionist_payload = {
        "receptionist": {
            "id": rec["id"], "receptionist_code": rec["receptionist_code"], "full_name": rec["full_name"],
        },
        "clinic": {"id": clinic["id"], "clinic_code": clinic["clinic_code"], "name": clinic["name"], "org_type": clinic["org_type"]},
    }
    if is_2fa_enabled(user["id"]):
        return jsonify(start_otp_challenge(user["id"], "receptionist", {"profile_id": rec["id"], "clinic_id": clinic["id"]}, receptionist_payload))
    token = issue_token(user["id"], "receptionist", {"profile_id": rec["id"], "clinic_id": clinic["id"]})
    add_audit(user["id"], "receptionist", "LOGIN", f"Clinic {clinic_code}")
    return jsonify({"token": token, **receptionist_payload})


# ---------------- Doctor ----------------
@bp.post("/doctor/login")
def doctor_login():
    """
    Doctor Login = Doctor ID + Clinic/Hospital ID + Password.
    A doctor may be linked to several organizations; the Clinic/Hospital ID
    typed at login selects which one this session is scoped to.
    """
    data = request.get_json(force=True) or {}
    doctor_code = (data.get("doctor_id") or data.get("doctor_code") or "").strip()
    clinic_code = (data.get("clinic_id") or data.get("clinic_code") or "").strip()
    password = data.get("password", "")

    if not doctor_code or not clinic_code or not password:
        return jsonify({"error": "Doctor ID, Clinic/Hospital ID and Password are required"}), 400

    doc = query("SELECT * FROM doctors WHERE doctor_code=%s", (doctor_code,), fetchone=True)
    if not doc:
        return jsonify({"error": "Invalid Doctor ID, Clinic/Hospital ID or Password"}), 401

    user = query("SELECT * FROM users WHERE id=%s AND role='doctor'", (doc["user_id"],), fetchone=True)
    if not user or not verify_password(password, user["password_hash"]):
        return jsonify({"error": "Invalid Doctor ID, Clinic/Hospital ID or Password"}), 401
    if not user["is_active"] or not doc["is_active"] or doc["verification_status"] != "APPROVED":
        return jsonify({"error": "This doctor account is not active"}), 403

    clinic = query("SELECT * FROM clinics WHERE clinic_code=%s", (clinic_code,), fetchone=True)
    if not clinic or clinic["status"] != "active" or clinic["approval_status"] != "APPROVED":
        return jsonify({"error": "Invalid Doctor ID, Clinic/Hospital ID or Password"}), 401

    link = query(
        "SELECT id FROM clinic_doctors WHERE doctor_id=%s AND clinic_id=%s AND status='active'",
        (doc["id"], clinic["id"]), fetchone=True,
    )
    if not link:
        return jsonify({"error": "This doctor is not associated with the given Clinic/Hospital ID"}), 403

    organizations = query(
        """SELECT c.id, c.clinic_code, c.name, c.org_type FROM clinic_doctors cd
           JOIN clinics c ON c.id = cd.clinic_id
           WHERE cd.doctor_id=%s AND cd.status='active' AND c.status='active' AND c.approval_status='APPROVED'
           ORDER BY c.name""",
        (doc["id"],),
    )
    doctor_payload = {
        "doctor": {
            "id": doc["id"], "doctor_code": doc["doctor_code"], "full_name": doc["full_name"],
            "specialization": doc["specialization"],
        },
        "clinic": {"id": clinic["id"], "clinic_code": clinic["clinic_code"], "name": clinic["name"], "org_type": clinic["org_type"]},
        "organizations": organizations,
    }
    if is_2fa_enabled(user["id"]):
        return jsonify(start_otp_challenge(user["id"], "doctor", {"profile_id": doc["id"], "clinic_id": clinic["id"]}, doctor_payload))
    token = issue_token(user["id"], "doctor", {"profile_id": doc["id"], "clinic_id": clinic["id"]})
    add_audit(user["id"], "doctor", "LOGIN", f"Clinic {clinic_code}")
    return jsonify({"token": token, **doctor_payload})


# ---------------- Admin ----------------
@bp.post("/admin/login")
def admin_login():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip()
    password = data.get("password", "")
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    user = query("SELECT * FROM users WHERE email=%s AND role='admin'", (email,), fetchone=True)
    if not user or not verify_password(password, user["password_hash"]):
        return jsonify({"error": "Invalid credentials"}), 401
    if not user["is_active"]:
        return jsonify({"error": "Account disabled"}), 403

    if is_2fa_enabled(user["id"]):
        return jsonify(start_otp_challenge(user["id"], "admin", {"profile_id": user["id"]}, {"admin": {"id": user["id"], "email": user["email"]}}))
    token = issue_token(user["id"], "admin", {"profile_id": user["id"]})
    add_audit(user["id"], "admin", "LOGIN")
    return jsonify({"token": token, "admin": {"id": user["id"], "email": user["email"]}})


# ---------------- Shared: logout / password reset ----------------
@bp.post("/logout")
@require_auth()
def logout():
    add_audit(g.user_id, g.role, "LOGOUT")
    # Stateless JWT: client discards token. (A token-blacklist table can be added if needed.)
    return jsonify({"message": "Logged out"})


GENERIC_RESET_MESSAGE = "If an account exists with this email, a password reset link has been sent."


@bp.post("/forgot-password")
def forgot_password():
    """
    Shared password recovery for every role (Patient, Doctor, Receptionist,
    Admin) — a user only ever has one password, tied to their `users` row,
    regardless of how many clinics a Doctor/Receptionist might belong to.
    Always returns the same generic message so a caller can't use this
    endpoint to probe whether a given email is registered.
    """
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip()
    generic_response = {"message": GENERIC_RESET_MESSAGE}
    if not email:
        return jsonify(generic_response), 200

    user = query(
        """SELECT u.id, u.role, u.is_active,
                  COALESCE(p.full_name, d.full_name, r.full_name, u.email) AS full_name
           FROM users u
           LEFT JOIN patients p ON p.user_id = u.id
           LEFT JOIN doctors d ON d.user_id = u.id
           LEFT JOIN receptionists r ON r.user_id = u.id
           WHERE u.email=%s""",
        (email,), fetchone=True,
    )
    # Do not leak whether the email exists, whether the account is disabled,
    # etc — always return the same generic response either way.
    if not user or not user["is_active"]:
        return jsonify(generic_response), 200

    reset_token = secrets.token_urlsafe(32)
    expires = datetime.datetime.utcnow() + datetime.timedelta(hours=1)
    execute(
        "UPDATE users SET reset_token=%s, reset_token_expires=%s WHERE id=%s",
        (reset_token, expires, user["id"]),
    )
    # The role travels with the link only so the shared /reset-password page
    # knows which login page to send the user back to afterwards — it plays
    # no part in validating the token itself.
    reset_link = f"{Config.FRONTEND_URL}/reset-password?token={reset_token}&role={user['role']}"
    emailed = send_password_reset_email(email, user.get("full_name"), reset_link)
    add_audit(user["id"], user["role"], "PASSWORD_RESET_REQUESTED")

    if not emailed and not Config.IS_PRODUCTION:
        # No SMTP configured yet (see .env.example) — surface the token/link
        # directly so local development and testing aren't blocked on it.
        # NEVER exposed when Config.IS_PRODUCTION is true.
        generic_response["dev_reset_token"] = reset_token
        generic_response["dev_reset_link"] = reset_link
    return jsonify(generic_response)


@bp.post("/reset-password")
def reset_password():
    data = request.get_json(force=True) or {}
    reset_token = data.get("reset_token") or ""
    new_password = data.get("new_password") or ""

    if not reset_token:
        return jsonify({"error": "Reset token is required"}), 400
    if len(new_password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    user = query(
        "SELECT id, role FROM users WHERE reset_token=%s AND reset_token_expires > UTC_TIMESTAMP()",
        (reset_token,), fetchone=True,
    )
    if not user:
        return jsonify({"error": "This reset link is invalid or has expired. Please request a new one."}), 400

    # Single-use: the token (and its expiry) are wiped in the same statement
    # that sets the new password, so it can never be replayed. Stamping
    # password_changed_at also invalidates any JWTs issued before this
    # moment (see require_auth's _token_still_valid check) — i.e. anyone
    # already logged in elsewhere is signed out once the password changes.
    execute(
        """UPDATE users
           SET password_hash=%s, reset_token=NULL, reset_token_expires=NULL, password_changed_at=UTC_TIMESTAMP()
           WHERE id=%s""",
        (hash_password(new_password), user["id"]),
    )
    add_audit(user["id"], user["role"], "PASSWORD_RESET_COMPLETED")
    return jsonify({"message": "Password reset successful"})


@bp.post("/change-password")
@require_auth()
def change_password():
    data = request.get_json(force=True) or {}
    new_password = data.get("new_password") or ""
    if len(new_password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    user = query("SELECT * FROM users WHERE id=%s", (g.user_id,), fetchone=True)
    if not verify_password(data.get("current_password", ""), user["password_hash"]):
        return jsonify({"error": "Current password incorrect"}), 400
    execute(
        "UPDATE users SET password_hash=%s, password_changed_at=UTC_TIMESTAMP() WHERE id=%s",
        (hash_password(new_password), g.user_id),
    )
    add_audit(g.user_id, g.role, "CHANGE_PASSWORD")
    return jsonify({"message": "Password changed"})


# ---------------- Forgot Doctor ID / Receptionist ID / Clinic ID ----------------
GENERIC_ID_MESSAGE = "If a matching account exists, we've emailed the requested ID to the registered address."
GENERIC_CLINIC_ID_MESSAGE = "If a matching account exists, its Clinic/Hospital details have been emailed to the registered address."


@bp.post("/forgot-doctor-id")
def forgot_doctor_id():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip()
    response = {"message": GENERIC_ID_MESSAGE}
    if not email:
        return jsonify(response), 200

    doctor = query(
        """SELECT d.id, d.doctor_code, d.full_name, u.email, u.is_active
           FROM doctors d JOIN users u ON u.id = d.user_id
           WHERE u.email=%s AND u.role='doctor'""",
        (email,), fetchone=True,
    )
    if doctor and doctor["is_active"]:
        emailed = send_doctor_id_email(doctor["email"], doctor["full_name"], doctor["doctor_code"])
        add_audit(doctor["id"], "doctor", "DOCTOR_ID_RECOVERY_REQUESTED")
        if not emailed and not Config.IS_PRODUCTION:
            response["dev_doctor_id"] = doctor["doctor_code"]
    return jsonify(response)


@bp.post("/forgot-receptionist-id")
def forgot_receptionist_id():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip()
    response = {"message": GENERIC_ID_MESSAGE}
    if not email:
        return jsonify(response), 200

    receptionist = query(
        """SELECT r.id, r.receptionist_code, r.full_name, r.clinic_id, u.email, u.is_active
           FROM receptionists r JOIN users u ON u.id = r.user_id
           WHERE u.email=%s AND u.role='receptionist'""",
        (email,), fetchone=True,
    )
    if receptionist and receptionist["is_active"]:
        clinic = None
        if receptionist["clinic_id"]:
            clinic = query("SELECT name FROM clinics WHERE id=%s", (receptionist["clinic_id"],), fetchone=True)
        emailed = send_receptionist_id_email(
            receptionist["email"], receptionist["full_name"], receptionist["receptionist_code"],
            clinic_name=clinic["name"] if clinic else None,
        )
        add_audit(receptionist["id"], "receptionist", "RECEPTIONIST_ID_RECOVERY_REQUESTED")
        if not emailed and not Config.IS_PRODUCTION:
            response["dev_receptionist_id"] = receptionist["receptionist_code"]
    return jsonify(response)


@bp.post("/forgot-clinic-id")
def forgot_clinic_id():
    """
    Looks the account up by email, Doctor ID, or Receptionist ID (whichever
    is supplied) and, if it matches exactly one account, emails that
    account's registered address the full list of Clinic/Hospital IDs it is
    authorized to use — never another user's organizations.
    """
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip()
    doctor_code = (data.get("doctor_id") or "").strip()
    receptionist_code = (data.get("receptionist_id") or "").strip()
    response = {"message": GENERIC_CLINIC_ID_MESSAGE}

    doctor = None
    receptionist = None
    if doctor_code:
        doctor = query(
            """SELECT d.id, d.full_name, u.email, u.is_active FROM doctors d
               JOIN users u ON u.id = d.user_id WHERE d.doctor_code=%s""",
            (doctor_code,), fetchone=True,
        )
    elif receptionist_code:
        receptionist = query(
            """SELECT r.id, r.full_name, r.clinic_id, u.email, u.is_active FROM receptionists r
               JOIN users u ON u.id = r.user_id WHERE r.receptionist_code=%s""",
            (receptionist_code,), fetchone=True,
        )
    elif email:
        doctor = query(
            """SELECT d.id, d.full_name, u.email, u.is_active FROM doctors d
               JOIN users u ON u.id = d.user_id WHERE u.email=%s AND u.role='doctor'""",
            (email,), fetchone=True,
        )
        if not doctor:
            receptionist = query(
                """SELECT r.id, r.full_name, r.clinic_id, u.email, u.is_active FROM receptionists r
                   JOIN users u ON u.id = r.user_id WHERE u.email=%s AND u.role='receptionist'""",
                (email,), fetchone=True,
            )

    if doctor and doctor["is_active"]:
        clinics = query(
            """SELECT c.clinic_code, c.name FROM clinic_doctors cd
               JOIN clinics c ON c.id = cd.clinic_id
               WHERE cd.doctor_id=%s AND cd.status='active' AND c.status='active'
               ORDER BY c.name""",
            (doctor["id"],),
        )
        emailed = send_clinic_id_email(doctor["email"], doctor["full_name"], clinics)
        add_audit(doctor["id"], "doctor", "CLINIC_ID_RECOVERY_REQUESTED")
        if not emailed and not Config.IS_PRODUCTION:
            response["dev_clinics"] = clinics
    elif receptionist and receptionist["is_active"]:
        clinics = []
        if receptionist["clinic_id"]:
            clinic = query(
                "SELECT clinic_code, name FROM clinics WHERE id=%s AND status='active'",
                (receptionist["clinic_id"],), fetchone=True,
            )
            if clinic:
                clinics = [clinic]
        emailed = send_clinic_id_email(receptionist["email"], receptionist["full_name"], clinics)
        add_audit(receptionist["id"], "receptionist", "CLINIC_ID_RECOVERY_REQUESTED")
        if not emailed and not Config.IS_PRODUCTION:
            response["dev_clinics"] = clinics

    return jsonify(response)


VALID_LANGUAGES = {"en", "hi", "gu"}


@bp.get("/language")
@require_auth()
def get_language():
    user = query("SELECT preferred_language FROM users WHERE id=%s", (g.user_id,), fetchone=True)
    return jsonify({"language": user["preferred_language"] if user else "en"})


@bp.post("/language")
@require_auth()
def set_language():
    data = request.get_json(force=True) or {}
    lang = data.get("language")
    if lang not in VALID_LANGUAGES:
        return jsonify({"error": f"language must be one of {', '.join(sorted(VALID_LANGUAGES))}"}), 400
    execute("UPDATE users SET preferred_language=%s WHERE id=%s", (lang, g.user_id))
    return jsonify({"language": lang})