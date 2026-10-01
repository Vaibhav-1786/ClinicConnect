"""
Admin management of the shared-receptionist doctor scope (migration_018).

Lets a hospital admin decide, per receptionist:
  - ALL doctors in the receptionist's clinic (the default, unchanged
    behaviour every existing receptionist already has), or
  - only doctors in specific DEPARTMENTs, or
  - only specific hand-picked doctors (SPECIFIC).

Enforced server-side in appointments.py — this UI/API only sets the
configuration, it is never itself the security boundary.
"""
from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit

bp = Blueprint("receptionist_access", __name__, url_prefix="/api/admin/receptionist-access")

VALID_ACCESS_TYPES = {"ALL", "DEPARTMENT", "SPECIFIC"}


@bp.get("/<int:receptionist_id>")
@require_auth(["admin"])
def get_access(receptionist_id):
    rec = query(
        "SELECT r.id, r.full_name, r.clinic_id, r.access_type FROM receptionists r WHERE r.id=%s",
        (receptionist_id,), fetchone=True,
    )
    if not rec:
        return jsonify({"error": "Receptionist not found"}), 404

    doctors = query(
        """SELECT d.id, d.full_name, d.specialization, d.department
           FROM clinic_doctors cd JOIN doctors d ON d.id = cd.doctor_id
           WHERE cd.clinic_id=%s AND cd.status='active' ORDER BY d.full_name""",
        (rec["clinic_id"],),
    )
    selected_doctor_ids = [
        r["doctor_id"] for r in query(
            "SELECT doctor_id FROM receptionist_doctor_access WHERE receptionist_id=%s", (receptionist_id,)
        )
    ]
    selected_departments = [
        r["department"] for r in query(
            "SELECT department FROM receptionist_department_access WHERE receptionist_id=%s", (receptionist_id,)
        )
    ]
    return jsonify({
        "receptionist": rec,
        "clinic_doctors": doctors,
        "access_type": rec["access_type"],
        "selected_doctor_ids": selected_doctor_ids,
        "selected_departments": selected_departments,
    })


@bp.put("/<int:receptionist_id>")
@require_auth(["admin"])
def set_access(receptionist_id):
    """Body: { access_type: 'ALL'|'DEPARTMENT'|'SPECIFIC',
               doctor_ids?: [int, ...],     # required if access_type='SPECIFIC'
               departments?: [str, ...] }   # required if access_type='DEPARTMENT'
    """
    rec = query("SELECT id, clinic_id FROM receptionists WHERE id=%s", (receptionist_id,), fetchone=True)
    if not rec:
        return jsonify({"error": "Receptionist not found"}), 404

    data = request.get_json(force=True) or {}
    access_type = data.get("access_type")
    if access_type not in VALID_ACCESS_TYPES:
        return jsonify({"error": f"access_type must be one of {sorted(VALID_ACCESS_TYPES)}"}), 400

    doctor_ids = data.get("doctor_ids") or []
    departments = data.get("departments") or []

    if access_type == "SPECIFIC" and not doctor_ids:
        return jsonify({"error": "At least one doctor_id is required for SPECIFIC access"}), 400
    if access_type == "DEPARTMENT" and not departments:
        return jsonify({"error": "At least one department is required for DEPARTMENT access"}), 400

    # Validate every referenced doctor actually belongs to this receptionist's clinic.
    if doctor_ids:
        placeholders = ",".join(["%s"] * len(doctor_ids))
        valid_ids = {
            r["doctor_id"] for r in query(
                f"SELECT doctor_id FROM clinic_doctors WHERE clinic_id=%s AND doctor_id IN ({placeholders})",
                [rec["clinic_id"], *doctor_ids],
            )
        }
        invalid = set(doctor_ids) - valid_ids
        if invalid:
            return jsonify({"error": f"Doctors not in this clinic: {sorted(invalid)}"}), 400

    execute("UPDATE receptionists SET access_type=%s WHERE id=%s", (access_type, receptionist_id))
    execute("DELETE FROM receptionist_doctor_access WHERE receptionist_id=%s", (receptionist_id,))
    execute("DELETE FROM receptionist_department_access WHERE receptionist_id=%s", (receptionist_id,))

    if access_type == "SPECIFIC":
        for doctor_id in doctor_ids:
            execute(
                "INSERT INTO receptionist_doctor_access (receptionist_id, doctor_id) VALUES (%s,%s)",
                (receptionist_id, doctor_id),
            )
    elif access_type == "DEPARTMENT":
        for dept in departments:
            execute(
                "INSERT INTO receptionist_department_access (receptionist_id, department) VALUES (%s,%s)",
                (receptionist_id, dept),
            )

    add_audit(g.user_id, "admin", "RECEPTIONIST_ACCESS_UPDATED", f"Receptionist #{receptionist_id} -> {access_type}")
    return jsonify({"message": "Access updated", "access_type": access_type})
