import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit

bp = Blueprint("insurance", __name__)

VALID_POLICY_TYPES = {"Individual", "Family Floater", "Group/Employer", "Government Scheme", "Other"}


def _validate(data, partial=False):
    errors = []
    if not partial or "provider" in data:
        if not (data.get("provider") or "").strip():
            errors.append("Insurance provider is required")
    if not partial or "policy_number" in data:
        if not (data.get("policy_number") or "").strip():
            errors.append("Policy number is required")
    if data.get("policy_type") and data["policy_type"] not in VALID_POLICY_TYPES:
        errors.append(f"Policy type must be one of {', '.join(sorted(VALID_POLICY_TYPES))}")
    for field in ("valid_from", "valid_until"):
        if data.get(field):
            try:
                datetime.datetime.strptime(data[field], "%Y-%m-%d")
            except ValueError:
                errors.append(f"{field} must be in YYYY-MM-DD format")
    if data.get("valid_from") and data.get("valid_until") and data["valid_from"] > data["valid_until"]:
        errors.append("valid_from cannot be after valid_until")
    return errors


def _owned(policy_id):
    return query(
        "SELECT * FROM insurance_profiles WHERE id=%s AND patient_id=%s",
        (policy_id, g.profile_id), fetchone=True,
    )


@bp.get("/api/patient/insurance")
@require_auth(["patient"])
def list_insurance():
    rows = query(
        "SELECT * FROM insurance_profiles WHERE patient_id=%s AND is_active=1 ORDER BY is_primary DESC, created_at DESC",
        (g.profile_id,),
    )
    return jsonify(rows)


@bp.post("/api/patient/insurance")
@require_auth(["patient"])
def add_insurance():
    data = request.get_json(force=True) or {}
    errors = _validate(data)
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400

    make_primary = bool(data.get("is_primary"))
    policy_id = execute(
        """INSERT INTO insurance_profiles
           (patient_id, provider, policy_number, member_id, valid_from, valid_until,
            policy_type, coverage_details, is_primary)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (g.profile_id, data["provider"].strip(), data["policy_number"].strip(), data.get("member_id"),
         data.get("valid_from"), data.get("valid_until"), data.get("policy_type", "Individual"),
         data.get("coverage_details"), 1 if make_primary else 0),
    )
    if make_primary:
        execute("UPDATE insurance_profiles SET is_primary=0 WHERE patient_id=%s AND id!=%s", (g.profile_id, policy_id))
    # First policy a patient ever adds becomes primary by default.
    elif query("SELECT COUNT(*) AS c FROM insurance_profiles WHERE patient_id=%s AND is_active=1", (g.profile_id,), fetchone=True)["c"] == 1:
        execute("UPDATE insurance_profiles SET is_primary=1 WHERE id=%s", (policy_id,))

    add_audit(g.user_id, "patient", "INSURANCE_ADDED", f"Policy #{policy_id}")
    return jsonify(_owned(policy_id)), 201


@bp.put("/api/patient/insurance/<int:policy_id>")
@require_auth(["patient"])
def update_insurance(policy_id):
    if not _owned(policy_id):
        return jsonify({"error": "Insurance policy not found"}), 404
    data = request.get_json(force=True) or {}
    errors = _validate(data, partial=True)
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400

    fields, params = [], []
    for f in ["provider", "policy_number", "member_id", "valid_from", "valid_until", "policy_type", "coverage_details"]:
        if f in data:
            fields.append(f"{f}=%s")
            params.append(data[f].strip() if isinstance(data[f], str) and f in ("provider", "policy_number") else data[f])
    if fields:
        params.extend([policy_id, g.profile_id])
        execute(f"UPDATE insurance_profiles SET {', '.join(fields)} WHERE id=%s AND patient_id=%s", params)

    add_audit(g.user_id, "patient", "INSURANCE_UPDATED", f"Policy #{policy_id}")
    return jsonify(_owned(policy_id))


@bp.post("/api/patient/insurance/<int:policy_id>/set-primary")
@require_auth(["patient"])
def set_primary_insurance(policy_id):
    if not _owned(policy_id):
        return jsonify({"error": "Insurance policy not found"}), 404
    execute("UPDATE insurance_profiles SET is_primary=0 WHERE patient_id=%s", (g.profile_id,))
    execute("UPDATE insurance_profiles SET is_primary=1 WHERE id=%s", (policy_id,))
    add_audit(g.user_id, "patient", "INSURANCE_SET_PRIMARY", f"Policy #{policy_id}")
    return jsonify(_owned(policy_id))


@bp.delete("/api/patient/insurance/<int:policy_id>")
@require_auth(["patient"])
def delete_insurance(policy_id):
    policy = _owned(policy_id)
    if not policy:
        return jsonify({"error": "Insurance policy not found"}), 404
    execute("UPDATE insurance_profiles SET is_active=0, is_primary=0 WHERE id=%s", (policy_id,))
    # Promote the next most recent remaining policy to primary, if this one was primary.
    if policy["is_primary"]:
        nxt = query(
            "SELECT id FROM insurance_profiles WHERE patient_id=%s AND is_active=1 ORDER BY created_at DESC LIMIT 1",
            (g.profile_id,), fetchone=True,
        )
        if nxt:
            execute("UPDATE insurance_profiles SET is_primary=1 WHERE id=%s", (nxt["id"],))
    add_audit(g.user_id, "patient", "INSURANCE_DELETED", f"Policy #{policy_id}")
    return jsonify({"message": "Insurance policy removed"})


# =================== Receptionist read access (billing screens) ===================
@bp.get("/api/receptionist/patients/<int:patient_id>/insurance")
@require_auth(["receptionist", "doctor"])
def receptionist_view_insurance(patient_id):
    # Receptionists/doctors only need this while actively processing billing or
    # care for a real patient — not a general patient lookup tool, so we don't
    # expose it outside billing/consultation flows in the frontend.
    rows = query(
        "SELECT * FROM insurance_profiles WHERE patient_id=%s AND is_active=1 ORDER BY is_primary DESC",
        (patient_id,),
    )
    return jsonify(rows)
