"""
Staff Management (spec section 18) — Nurses, Pharmacists, Lab Staff.

Doctors and Receptionists already have their own dedicated tables and
admin pages (unchanged here). This adds the remaining staff types
behind one generic, admin-managed table so further types can be added
later (new ENUM value) without a schema rewrite. These are personnel
records only — no login/dashboard of their own yet, which is a real
scope boundary worth being upfront about.
"""
from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.permissions import require_permission
from app.utils.helpers import add_audit

bp = Blueprint("staff", __name__, url_prefix="/api/admin/staff")

VALID_TYPES = {"nurse", "pharmacist", "lab_technician"}


@bp.get("")
@require_auth(["admin"])
def list_staff():
    staff_type = request.args.get("staff_type")
    clinic_id = request.args.get("clinic_id", type=int)
    sql = """SELECT s.*, c.name AS clinic_name FROM staff_members s
             JOIN clinics c ON c.id = s.clinic_id WHERE 1=1"""
    params = []
    if staff_type:
        sql += " AND s.staff_type=%s"; params.append(staff_type)
    if clinic_id:
        sql += " AND s.clinic_id=%s"; params.append(clinic_id)
    sql += " ORDER BY s.is_active DESC, s.full_name"
    return jsonify(query(sql, params))


@bp.post("")
@require_auth(["admin"])
@require_permission("admin.manage_staff")
def create_staff():
    data = request.get_json(force=True) or {}
    if data.get("staff_type") not in VALID_TYPES:
        return jsonify({"error": f"staff_type must be one of {sorted(VALID_TYPES)}"}), 400
    required = ["full_name", "clinic_id"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    staff_id = execute(
        """INSERT INTO staff_members
           (staff_type, full_name, phone, email, clinic_id, department, specialization, working_hours)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (data["staff_type"], data["full_name"], data.get("phone"), data.get("email"),
         data["clinic_id"], data.get("department"), data.get("specialization"), data.get("working_hours")),
    )
    add_audit(g.user_id, g.role, "STAFF_CREATED", f"{data['staff_type']} #{staff_id}: {data['full_name']}")
    return jsonify({"id": staff_id, "message": "Staff member added"}), 201


@bp.put("/<int:staff_id>")
@require_auth(["admin"])
@require_permission("admin.manage_staff")
def update_staff(staff_id):
    data = request.get_json(force=True) or {}
    fields, params = [], []
    for col in ("full_name", "phone", "email", "department", "specialization", "working_hours", "is_active"):
        if col in data:
            fields.append(f"{col}=%s")
            params.append(data[col])
    if not fields:
        return jsonify({"error": "No fields to update"}), 400
    params.append(staff_id)
    execute(f"UPDATE staff_members SET {', '.join(fields)} WHERE id=%s", params)
    add_audit(g.user_id, g.role, "STAFF_UPDATED", f"Staff #{staff_id}")
    return jsonify({"message": "Staff member updated"})


@bp.delete("/<int:staff_id>")
@require_auth(["admin"])
@require_permission("admin.manage_staff")
def deactivate_staff(staff_id):
    """Soft-delete only — keeps leave/history rows meaningful."""
    execute("UPDATE staff_members SET is_active=0 WHERE id=%s", (staff_id,))
    add_audit(g.user_id, g.role, "STAFF_DEACTIVATED", f"Staff #{staff_id}")
    return jsonify({"message": "Staff member deactivated"})


@bp.post("/<int:staff_id>/leaves")
@require_auth(["admin"])
@require_permission("admin.manage_staff")
def add_leave(staff_id):
    data = request.get_json(force=True) or {}
    if not data.get("leave_date"):
        return jsonify({"error": "leave_date is required"}), 400
    leave_id = execute(
        "INSERT INTO staff_leaves (staff_id, leave_date, reason, status) VALUES (%s,%s,%s,%s)",
        (staff_id, data["leave_date"], data.get("reason"), data.get("status", "pending")),
    )
    return jsonify({"id": leave_id}), 201


@bp.get("/<int:staff_id>/leaves")
@require_auth(["admin"])
def list_leaves(staff_id):
    return jsonify(query(
        "SELECT * FROM staff_leaves WHERE staff_id=%s ORDER BY leave_date DESC", (staff_id,),
    ))


@bp.put("/leaves/<int:leave_id>/status")
@require_auth(["admin"])
@require_permission("admin.manage_staff")
def update_leave_status(leave_id):
    data = request.get_json(force=True) or {}
    status = data.get("status")
    if status not in ("pending", "approved", "rejected"):
        return jsonify({"error": "status must be pending, approved, or rejected"}), 400
    execute("UPDATE staff_leaves SET status=%s WHERE id=%s", (status, leave_id))
    return jsonify({"message": "Leave status updated"})
