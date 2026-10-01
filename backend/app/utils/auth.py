import datetime
import functools

import jwt
from flask import request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash

from config import Config
from app.utils.db import query


def hash_password(plain: str) -> str:
    return generate_password_hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return check_password_hash(hashed, plain)


def issue_token(user_id: int, role: str, extra: dict = None) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=Config.JWT_EXPIRES_HOURS),
        "iat": datetime.datetime.utcnow(),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, Config.JWT_SECRET, algorithm="HS256")


def decode_token(token: str):
    return jwt.decode(token, Config.JWT_SECRET, algorithms=["HS256"])


def _token_still_valid(payload):
    """
    A password reset/change must kill any JWTs issued before it, even though
    JWTs are otherwise stateless. We stamp users.password_changed_at whenever
    the password changes (see reset_password/change_password) and compare it
    against this token's issued-at time. Tokens issued before the most recent
    password change are rejected. Safe by default: if the column is NULL
    (password never changed since this feature shipped) or the timestamp
    can't be parsed, the token is treated as valid.
    """
    user_id = payload.get("sub")
    iat = payload.get("iat")
    if not user_id or iat is None:
        return True
    row = query("SELECT password_changed_at FROM users WHERE id=%s", (user_id,), fetchone=True)
    changed_at = row.get("password_changed_at") if row else None
    if not changed_at:
        return True
    try:
        if isinstance(changed_at, str):
            changed_at = datetime.datetime.fromisoformat(changed_at)
        issued_at = datetime.datetime.utcfromtimestamp(iat)
        # >= (not strictly >): MySQL TIMESTAMP and JWT iat both have only
        # second-level precision. A fresh login's token is always issued by
        # a separate follow-up request *after* reset-password/change-password
        # returns, but on a fast automated flow (or a very fast human) both
        # can legitimately land in the same UTC second. Treating "same
        # second" as valid means that brand-new, legitimate token is never
        # incorrectly rejected; the (much less likely, and low-severity)
        # trade-off is that a pre-existing token minted in that same second
        # keeps working until it naturally expires instead of being killed
        # immediately — still a huge improvement over no invalidation at all.
        return issued_at >= changed_at
    except (ValueError, TypeError, OSError):
        return True


def require_auth(allowed_roles=None):
    """Decorator enforcing a valid JWT and (optionally) a role whitelist."""

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return jsonify({"error": "Missing or invalid Authorization header"}), 401
            token = auth_header.split(" ", 1)[1]
            try:
                payload = decode_token(token)
            except jwt.ExpiredSignatureError:
                return jsonify({"error": "Token expired"}), 401
            except jwt.InvalidTokenError:
                return jsonify({"error": "Invalid token"}), 401

            if allowed_roles and payload.get("role") not in allowed_roles:
                return jsonify({"error": "Forbidden: insufficient role"}), 403

            if not _token_still_valid(payload):
                return jsonify({"error": "Your session has expired because your password was changed. Please log in again."}), 401

            g.user_id = payload.get("sub")
            g.role = payload.get("role")
            g.profile_id = payload.get("profile_id")
            # Present only for doctor/receptionist tokens: which clinic/hospital
            # this session is currently scoped to (multi-org support).
            g.clinic_id = payload.get("clinic_id")
            return fn(*args, **kwargs)

        return wrapper

    return decorator
