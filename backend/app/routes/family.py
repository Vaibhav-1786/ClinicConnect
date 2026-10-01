import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit

bp = Blueprint("family", __name__, url_prefix="/api/patient/family")

VALID_RELATIONSHIPS = {"Self", "Child", "Parent", "Grandparent", "Spouse", "Sibling", "Other"}
VALID_GENDERS = {"Male", "Female", "Other"}


def _validate(data, partial=False):
    errors = []
    if not partial or "full_name" in data:
        if not (data.get("full_name") or "").strip():
            errors.append("Full name is required")
    if not partial or "relationship" in data:
        if data.get("relationship") not in VALID_RELATIONSHIPS:
            errors.append(f"Relationship must be one of {', '.join(sorted(VALID_RELATIONSHIPS))}")
    if data.get("gender") and data["gender"] not in VALID_GENDERS:
        errors.append("Gender must be Male, Female, or Other")
    if data.get("dob"):
        try:
            parsed = datetime.datetime.strptime(data["dob"], "%Y-%m-%d").date()
            if parsed > datetime.date.today():
                errors.append("Date of birth cannot be in the future")
        except ValueError:
            errors.append("Date of birth must be in YYYY-MM-DD format")
    if data.get("mobile_number") and not str(data["mobile_number"]).strip().isdigit():
        errors.append("Mobile number must contain digits only")
    return errors


def _owned_member(member_id):
    """Fetch a family member row only if it belongs to the logged-in patient."""
    return query(
        "SELECT * FROM family_members WHERE id=%s AND patient_id=%s",
        (member_id, g.profile_id), fetchone=True,
    )


@bp.get("")
@require_auth(["patient"])
def list_family_members():
    members = query(
        """SELECT * FROM family_members WHERE patient_id=%s AND is_active=1
           ORDER BY FIELD(relationship,'Self','Child','Parent','Grandparent','Spouse','Sibling','Other'), full_name""",
        (g.profile_id,),
    )
    return jsonify(members)


@bp.get("/<int:member_id>")
@require_auth(["patient"])
def get_family_member(member_id):
    member = _owned_member(member_id)
    if not member:
        return jsonify({"error": "Family member not found"}), 404
    return jsonify(member)


@bp.post("")
@require_auth(["patient"])
def add_family_member():
    data = request.get_json(force=True) or {}
    errors = _validate(data)
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400

    member_id = execute(
        """INSERT INTO family_members
           (patient_id, full_name, dob, gender, relationship, mobile_number,
            address, blood_group, allergies, emergency_contact)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (g.profile_id, data["full_name"].strip(), data.get("dob"), data.get("gender"),
         data["relationship"], data.get("mobile_number"), data.get("address"),
         data.get("blood_group"), data.get("allergies"), data.get("emergency_contact")),
    )
    add_audit(g.user_id, "patient", "FAMILY_MEMBER_ADDED", f"Family member #{member_id}")
    return jsonify(_owned_member(member_id)), 201


@bp.put("/<int:member_id>")
@require_auth(["patient"])
def update_family_member(member_id):
    if not _owned_member(member_id):
        return jsonify({"error": "Family member not found"}), 404
    data = request.get_json(force=True) or {}
    errors = _validate(data, partial=True)
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400

    fields, params = [], []
    for f in ["full_name", "dob", "gender", "relationship", "mobile_number",
              "address", "blood_group", "allergies", "emergency_contact"]:
        if f in data:
            fields.append(f"{f}=%s")
            params.append(data[f].strip() if f == "full_name" else data[f])
    if not fields:
        return jsonify({"error": "No fields to update"}), 400

    params.extend([member_id, g.profile_id])
    execute(f"UPDATE family_members SET {', '.join(fields)} WHERE id=%s AND patient_id=%s", params)
    add_audit(g.user_id, "patient", "FAMILY_MEMBER_UPDATED", f"Family member #{member_id}")
    return jsonify(_owned_member(member_id))


@bp.delete("/<int:member_id>")
@require_auth(["patient"])
def delete_family_member(member_id):
    if not _owned_member(member_id):
        return jsonify({"error": "Family member not found"}), 404

    # Soft-delete so historical appointments/prescriptions linked to this
    # dependent keep displaying correctly instead of orphaning references.
    active_plans = query(
        "SELECT id FROM recurring_appointment_plans WHERE family_member_id=%s AND status='ACTIVE'",
        (member_id,),
    )
    if active_plans:
        return jsonify({"error": "Cannot delete: this family member has an active recurring appointment plan. Cancel it first."}), 409

    execute("UPDATE family_members SET is_active=0 WHERE id=%s AND patient_id=%s", (member_id, g.profile_id))
    add_audit(g.user_id, "patient", "FAMILY_MEMBER_DELETED", f"Family member #{member_id}")
    return jsonify({"message": "Family member removed"})
