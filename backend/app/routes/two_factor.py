import datetime
import json
import secrets

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import hash_password, verify_password, issue_token, require_auth
from app.utils.helpers import gen_code, add_audit, add_notification

bp = Blueprint("two_factor", __name__, url_prefix="/api/auth")

OTP_TTL_MINUTES = 5
MAX_OTP_ATTEMPTS = 5


def is_2fa_enabled(user_id):
    row = query("SELECT enabled FROM two_factor_settings WHERE user_id=%s", (user_id,), fetchone=True)
    return bool(row and row["enabled"])


def start_otp_challenge(user_id, role, extra_claims, response_extra):
    """Called by each role's /login endpoint once credentials check out. Never
    issues the final JWT yet — only a short-lived, single-purpose
    pending_token the client must pair with the OTP to actually get a session.
    The OTP itself is hashed before storage, exactly like a password."""
    otp = gen_code("", 6)
    pending_token = secrets.token_urlsafe(32)
    expires_at = datetime.datetime.utcnow() + datetime.timedelta(minutes=OTP_TTL_MINUTES)

    execute(
        """INSERT INTO otp_codes (user_id, role, pending_token, otp_hash, extra_claims, response_payload, expires_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s)""",
        (user_id, role, pending_token, hash_password(otp), json.dumps(extra_claims or {}),
         json.dumps(response_extra or {}), expires_at),
    )
    add_notification(user_id, "security_otp", "Your login verification code",
                      f"Your one-time code is {otp}. It expires in {OTP_TTL_MINUTES} minutes.")

    # There is no SMS/email gateway configured in this project (see README) —
    # exactly like the existing forgot-password flow's dev_reset_token, the
    # code is returned directly here for local development/testing only.
    return {"otp_required": True, "pending_token": pending_token, "dev_otp": otp, "expires_in_minutes": OTP_TTL_MINUTES}


@bp.post("/verify-otp")
def verify_otp():
    data = request.get_json(force=True) or {}
    pending_token = data.get("pending_token")
    otp = (data.get("otp") or "").strip()
    if not pending_token or not otp:
        return jsonify({"error": "pending_token and otp are required"}), 400

    row = query(
        "SELECT * FROM otp_codes WHERE pending_token=%s AND consumed_at IS NULL", (pending_token,), fetchone=True,
    )
    if not row:
        return jsonify({"error": "This login session has expired. Please log in again."}), 400
    expires_at = row["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.datetime.fromisoformat(expires_at)
    if expires_at < datetime.datetime.utcnow():
        return jsonify({"error": "This code has expired. Please log in again."}), 400
    if row["attempts"] >= MAX_OTP_ATTEMPTS:
        return jsonify({"error": "Too many incorrect attempts. Please log in again."}), 429

    if not verify_password(otp, row["otp_hash"]):
        execute("UPDATE otp_codes SET attempts=attempts+1 WHERE id=%s", (row["id"],))
        remaining = MAX_OTP_ATTEMPTS - row["attempts"] - 1
        return jsonify({"error": f"Incorrect code. {max(remaining, 0)} attempt(s) remaining."}), 401

    execute("UPDATE otp_codes SET consumed_at=NOW() WHERE id=%s", (row["id"],))
    extra_claims = json.loads(row["extra_claims"] or "{}")
    response_extra = json.loads(row["response_payload"] or "{}")
    token = issue_token(row["user_id"], row["role"], extra_claims)
    add_audit(row["user_id"], row["role"], "LOGIN_OTP_VERIFIED")
    return jsonify({"token": token, **response_extra})


@bp.post("/2fa/resend")
def resend_otp():
    data = request.get_json(force=True) or {}
    pending_token = data.get("pending_token")
    row = query(
        "SELECT * FROM otp_codes WHERE pending_token=%s AND consumed_at IS NULL", (pending_token,), fetchone=True,
    )
    if not row:
        return jsonify({"error": "This login session has expired. Please log in again."}), 400

    otp = gen_code("", 6)
    expires_at = datetime.datetime.utcnow() + datetime.timedelta(minutes=OTP_TTL_MINUTES)
    execute(
        "UPDATE otp_codes SET otp_hash=%s, expires_at=%s, attempts=0 WHERE id=%s",
        (hash_password(otp), expires_at, row["id"]),
    )
    add_notification(row["user_id"], "security_otp", "Your login verification code",
                      f"Your one-time code is {otp}. It expires in {OTP_TTL_MINUTES} minutes.")
    return jsonify({"message": "A new code has been sent", "dev_otp": otp, "expires_in_minutes": OTP_TTL_MINUTES})


# ==================== Account Security Settings ====================
@bp.get("/2fa/status")
@require_auth()
def two_factor_status():
    return jsonify({"enabled": is_2fa_enabled(g.user_id)})


@bp.post("/2fa/toggle")
@require_auth()
def two_factor_toggle():
    data = request.get_json(force=True) or {}
    enabled = bool(data.get("enabled"))
    execute(
        """INSERT INTO two_factor_settings (user_id, enabled) VALUES (%s,%s)
           ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)""",
        (g.user_id, 1 if enabled else 0),
    )
    add_audit(g.user_id, g.role, "TWO_FACTOR_TOGGLED", f"enabled={enabled}")
    return jsonify({"enabled": enabled})
