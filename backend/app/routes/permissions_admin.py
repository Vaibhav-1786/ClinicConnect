"""
Admin-facing endpoints for the Granular Role Permissions feature
(spec section 17): list all permission keys, see a role's defaults,
see/set a specific user's effective permissions and overrides.
"""
from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit
from app.utils.permissions import get_effective_permissions

bp = Blueprint("permissions_admin", __name__, url_prefix="/api/admin/permissions")


@bp.get("")
@require_auth(["admin"])
def list_permissions():
    perms = query("SELECT * FROM permissions ORDER BY category, permission_key")
    role_map = {}
    for row in query("SELECT role, permission_key FROM role_permissions"):
        role_map.setdefault(row["role"], []).append(row["permission_key"])
    return jsonify({"permissions": perms, "role_defaults": role_map})


@bp.get("/users/<int:user_id>")
@require_auth(["admin"])
def get_user_permissions(user_id):
    user = query("SELECT id, email, role FROM users WHERE id=%s", (user_id,), fetchone=True)
    if not user:
        return jsonify({"error": "User not found"}), 404
    overrides = query(
        "SELECT permission_key, granted FROM user_permission_overrides WHERE user_id=%s", (user_id,),
    )
    return jsonify({
        "user": user,
        "effective_permissions": get_effective_permissions(user_id, user["role"]),
        "overrides": overrides,
    })


@bp.put("/users/<int:user_id>")
@require_auth(["admin"])
def set_user_permission_override(user_id):
    """Body: { permission_key, granted: true|false } to set an override,
    or { permission_key, granted: null } to remove one (revert to role default)."""
    data = request.get_json(force=True) or {}
    permission_key = data.get("permission_key")
    granted = data.get("granted")
    if not permission_key:
        return jsonify({"error": "permission_key is required"}), 400

    if granted is None:
        execute(
            "DELETE FROM user_permission_overrides WHERE user_id=%s AND permission_key=%s",
            (user_id, permission_key),
        )
        add_audit(g.user_id, g.role, "PERMISSION_OVERRIDE_CLEARED", f"User #{user_id}: {permission_key} -> role default")
        return jsonify({"message": "Reverted to role default"})

    execute(
        """INSERT INTO user_permission_overrides (user_id, permission_key, granted, granted_by_user_id)
           VALUES (%s,%s,%s,%s)
           ON DUPLICATE KEY UPDATE granted=VALUES(granted), granted_by_user_id=VALUES(granted_by_user_id)""",
        (user_id, permission_key, 1 if granted else 0, g.user_id),
    )
    add_audit(
        g.user_id, g.role, "PERMISSION_OVERRIDE_SET",
        f"User #{user_id}: {permission_key} -> {'granted' if granted else 'revoked'}",
    )
    return jsonify({"message": "Permission override saved"})


@bp.get("/me")
@require_auth()
def my_permissions():
    """Any signed-in user can see their own effective permission list —
    useful for the frontend to conditionally show controls (in addition
    to, never instead of, the server-side check on the action itself)."""
    return jsonify({"permissions": get_effective_permissions(g.user_id, g.role)})
