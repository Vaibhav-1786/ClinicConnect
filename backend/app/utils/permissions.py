"""
Granular Role Permissions (spec section 17).

Roles stay exactly as they were (admin/doctor/receptionist/patient) and
`require_auth([roles])` keeps working unchanged everywhere it's already
used. This module adds a finer-grained, *additional* check on top: a
named permission_key (e.g. "receptionist.manage_billing") that can be
required on a route via `require_permission(...)`, and that an admin
can override per-user without changing anyone's role.

Resolution order for a given (user_id, role, permission_key):
  1. A row in user_permission_overrides for this user -> use it (grant or revoke).
  2. Otherwise, the role's default from role_permissions.
  3. Otherwise, denied.

This is enforced server-side only — exactly as the spec requires
("Never rely only on hiding a button in React for security").
"""
from functools import wraps
from flask import g, jsonify

from app.utils.db import query


def has_permission(user_id, role, permission_key):
    override = query(
        "SELECT granted FROM user_permission_overrides WHERE user_id=%s AND permission_key=%s",
        (user_id, permission_key), fetchone=True,
    )
    if override is not None:
        return bool(override["granted"])
    role_default = query(
        "SELECT 1 FROM role_permissions WHERE role=%s AND permission_key=%s",
        (role, permission_key), fetchone=True,
    )
    return role_default is not None


def get_effective_permissions(user_id, role):
    role_defaults = {r["permission_key"] for r in query(
        "SELECT permission_key FROM role_permissions WHERE role=%s", (role,),
    )}
    overrides = query(
        "SELECT permission_key, granted FROM user_permission_overrides WHERE user_id=%s", (user_id,),
    )
    effective = set(role_defaults)
    for o in overrides:
        if o["granted"]:
            effective.add(o["permission_key"])
        else:
            effective.discard(o["permission_key"])
    return sorted(effective)


def require_permission(permission_key):
    """Use together with (after) @require_auth([...]) on a route:

        @bp.post("/invoices")
        @require_auth(["receptionist"])
        @require_permission("receptionist.manage_billing")
        def create_invoice(): ...

    require_auth must run first so g.user_id / g.role are set.
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not has_permission(g.user_id, g.role, permission_key):
                return jsonify({"error": "Forbidden — missing permission", "permission": permission_key}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator
