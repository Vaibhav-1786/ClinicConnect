from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit
from app.services import application_timeline, duplicates

bp = Blueprint("admin_workflow", __name__, url_prefix="/api/admin")


# ==================== Application Timeline (feature 9) ====================
@bp.get("/applications/<int:app_id>/timeline")
@require_auth(["admin"])
def get_application_timeline(app_id):
    application = query("SELECT id FROM doctor_applications WHERE id=%s", (app_id,), fetchone=True)
    if not application:
        return jsonify({"error": "Application not found"}), 404
    return jsonify(application_timeline.get_timeline(app_id))


# ==================== Internal Admin Comments (feature 15) ====================
ENTITY_TYPES = {"APPLICATION", "DOCTOR", "CLINIC", "DOCUMENT", "VERIFICATION"}


@bp.get("/comments/<entity_type>/<int:entity_id>")
@require_auth(["admin"])
def list_comments(entity_type, entity_id):
    entity_type = entity_type.upper()
    if entity_type not in ENTITY_TYPES:
        return jsonify({"error": f"entity_type must be one of {', '.join(sorted(ENTITY_TYPES))}"}), 400
    rows = query(
        """SELECT ac.*, u.email AS author_email FROM admin_comments ac
           JOIN users u ON u.id = ac.author_admin_id
           WHERE ac.entity_type=%s AND ac.entity_id=%s AND ac.is_deleted=0
           ORDER BY ac.created_at ASC""",
        (entity_type, entity_id),
    )
    # Never surfaced on any public/patient-facing endpoint — internal only.
    return jsonify(rows)


@bp.post("/comments/<entity_type>/<int:entity_id>")
@require_auth(["admin"])
def add_comment(entity_type, entity_id):
    entity_type = entity_type.upper()
    if entity_type not in ENTITY_TYPES:
        return jsonify({"error": f"entity_type must be one of {', '.join(sorted(ENTITY_TYPES))}"}), 400
    data = request.get_json(force=True) or {}
    text = (data.get("comment") or "").strip()
    if not text:
        return jsonify({"error": "comment is required"}), 400
    comment_id = execute(
        "INSERT INTO admin_comments (entity_type, entity_id, author_admin_id, comment) VALUES (%s,%s,%s,%s)",
        (entity_type, entity_id, g.user_id, text),
    )
    add_audit(g.user_id, "admin", "ADMIN_COMMENT_ADDED", f"{entity_type} #{entity_id}")
    return jsonify(query("SELECT * FROM admin_comments WHERE id=%s", (comment_id,), fetchone=True)), 201


@bp.put("/comments/<int:comment_id>")
@require_auth(["admin"])
def edit_comment(comment_id):
    comment = query("SELECT * FROM admin_comments WHERE id=%s AND is_deleted=0", (comment_id,), fetchone=True)
    if not comment:
        return jsonify({"error": "Comment not found"}), 404
    if comment["author_admin_id"] != g.user_id:
        return jsonify({"error": "You can only edit your own comments"}), 403
    data = request.get_json(force=True) or {}
    text = (data.get("comment") or "").strip()
    if not text:
        return jsonify({"error": "comment is required"}), 400
    execute("UPDATE admin_comments SET comment=%s, is_edited=1, edited_at=NOW() WHERE id=%s", (text, comment_id))
    return jsonify({"message": "Updated"})


@bp.delete("/comments/<int:comment_id>")
@require_auth(["admin"])
def delete_comment(comment_id):
    comment = query("SELECT * FROM admin_comments WHERE id=%s AND is_deleted=0", (comment_id,), fetchone=True)
    if not comment:
        return jsonify({"error": "Comment not found"}), 404
    if comment["author_admin_id"] != g.user_id:
        return jsonify({"error": "You can only delete your own comments"}), 403
    execute("UPDATE admin_comments SET is_deleted=1, deleted_at=NOW() WHERE id=%s", (comment_id,))
    add_audit(g.user_id, "admin", "ADMIN_COMMENT_DELETED", f"Comment #{comment_id}")
    return jsonify({"message": "Deleted"})


# ==================== QR Code Doctor Profile (feature 11) ====================
@bp.get("/doctors/<int:doctor_id>/qr-profile")
@require_auth(["admin"])
def get_qr_profile(doctor_id):
    from app.services import qr_profile
    doctor = query("SELECT id FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404
    profile = qr_profile.get_or_create_profile(doctor_id)
    url = qr_profile.public_profile_url(profile["public_token"])
    return jsonify({
        "public_token": profile["public_token"], "public_url": url,
        "regenerated_count": profile["regenerated_count"],
        "qr_svg": qr_profile.generate_qr_svg(url),
    })


@bp.post("/doctors/<int:doctor_id>/qr-profile/regenerate")
@require_auth(["admin"])
def regenerate_qr_profile(doctor_id):
    from app.services import qr_profile
    doctor = query("SELECT id FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404
    profile = qr_profile.regenerate_token(doctor_id)
    url = qr_profile.public_profile_url(profile["public_token"])
    add_audit(g.user_id, "admin", "DOCTOR_QR_REGENERATED", f"Doctor #{doctor_id}")
    return jsonify({
        "public_token": profile["public_token"], "public_url": url,
        "regenerated_count": profile["regenerated_count"],
        "qr_svg": qr_profile.generate_qr_svg(url),
    })


# ==================== Duplicate Doctor Detection (feature 13) ====================
@bp.get("/applications/<int:app_id>/duplicate-check")
@require_auth(["admin"])
def duplicate_check(app_id):
    application = query("SELECT * FROM doctor_applications WHERE id=%s", (app_id,), fetchone=True)
    if not application:
        return jsonify({"error": "Application not found"}), 404
    existing = query(
        "SELECT * FROM duplicate_detection_results WHERE application_id=%s ORDER BY overall_match_pct DESC",
        (app_id,),
    )
    if not existing:
        existing = duplicates.run_and_store_detection(
            application_id=app_id, full_name=application["full_name"], mobile=application["mobile"],
            email=application["email"], registration_number=application["registration_number"],
            dob=application["dob"],
        )
    return jsonify(existing)


@bp.post("/duplicate-check/<int:result_id>/decision")
@require_auth(["admin"])
def duplicate_check_decision(result_id):
    data = request.get_json(force=True) or {}
    decision = data.get("decision")
    if decision not in ("VIEWED_EXISTING", "CONTINUED_ANYWAY", "MERGED"):
        return jsonify({"error": "decision must be one of VIEWED_EXISTING, CONTINUED_ANYWAY, MERGED"}), 400
    result = query("SELECT id FROM duplicate_detection_results WHERE id=%s", (result_id,), fetchone=True)
    if not result:
        return jsonify({"error": "Result not found"}), 404
    duplicates.record_admin_decision(result_id, decision, g.user_id)
    add_audit(g.user_id, "admin", "DUPLICATE_DECISION_RECORDED", f"Result #{result_id}: {decision}")
    return jsonify({"message": "Recorded"})


# ==================== Doctor Multi-Clinic Schedule + Conflicts (feature 8) ====================
def _overlaps(start_a, end_a, start_b, end_b):
    def minutes(t):
        if isinstance(t, str):
            h, m = t.split(":")[:2]
            return int(h) * 60 + int(m)
        return t.hour * 60 + t.minute
    return minutes(start_a) < minutes(end_b) and minutes(start_b) < minutes(end_a)


@bp.get("/doctors/<int:doctor_id>/schedule")
@require_auth(["admin"])
def doctor_weekly_schedule(doctor_id):
    doctor = query("SELECT id FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404
    rows = query(
        """SELECT da.*, c.name AS clinic_name, c.org_type FROM doctor_availability da
           JOIN clinics c ON c.id = da.clinic_id
           WHERE da.doctor_id=%s AND da.is_active=1
           ORDER BY da.day_of_week, da.start_time""",
        (doctor_id,),
    )
    conflicts = []
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            a, b = rows[i], rows[j]
            if a["day_of_week"] == b["day_of_week"] and a["clinic_id"] != b["clinic_id"] and \
               _overlaps(a["start_time"], a["end_time"], b["start_time"], b["end_time"]):
                conflicts.append({"a": a, "b": b})
    return jsonify({"schedule": rows, "conflicts": conflicts})


@bp.post("/doctors/<int:doctor_id>/schedule/<int:availability_id>/resolve-conflict")
@require_auth(["admin"])
def resolve_schedule_conflict(doctor_id, availability_id):
    """Admin resolution: deactivate one of the two conflicting slots (chosen
    by the admin in the UI) rather than the system silently picking one."""
    row = query(
        "SELECT * FROM doctor_availability WHERE id=%s AND doctor_id=%s", (availability_id, doctor_id), fetchone=True
    )
    if not row:
        return jsonify({"error": "Schedule slot not found"}), 404
    execute("UPDATE doctor_availability SET is_active=0 WHERE id=%s", (availability_id,))
    add_audit(g.user_id, "admin", "SCHEDULE_CONFLICT_RESOLVED", f"Doctor #{doctor_id}, slot #{availability_id} deactivated")
    return jsonify({"message": "Slot deactivated"})
