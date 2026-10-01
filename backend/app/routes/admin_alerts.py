from flask import Blueprint, request, jsonify, g

from app.utils.db import query
from app.utils.auth import require_auth
from app.utils.helpers import add_audit
from app.services import alerts as alerts_service

bp = Blueprint("admin_alerts", __name__, url_prefix="/api/admin")


@bp.get("/alerts")
@require_auth(["admin"])
def get_alerts():
    include_resolved = request.args.get("include_resolved") == "true"
    if include_resolved:
        return jsonify(alerts_service.list_alerts(include_resolved=True))
    # Regenerate on read so the Action Required section always reflects live
    # state, then return the still-open alerts grouped by severity.
    return jsonify(alerts_service.generate_alerts())


@bp.post("/alerts/<int:alert_id>/read")
@require_auth(["admin"])
def mark_alert_read(alert_id):
    alerts_service.mark_read(alert_id)
    return jsonify({"message": "Marked read"})


@bp.post("/alerts/<int:alert_id>/resolve")
@require_auth(["admin"])
def resolve_alert(alert_id):
    alerts_service.resolve_alert(alert_id, g.user_id)
    add_audit(g.user_id, "admin", "ALERT_RESOLVED", f"Alert #{alert_id}")
    return jsonify({"message": "Resolved"})


# ==================== Admin Command Center summary (feature 16) ====================
@bp.get("/command-center/summary")
@require_auth(["admin"])
def command_center_summary():
    alerts = alerts_service.generate_alerts()
    action_required_count = len(alerts["URGENT"]) + len(alerts["ATTENTION"])

    counts = {
        "pending_applications": query(
            "SELECT COUNT(*) c FROM doctor_applications WHERE status IN ('PENDING','UNDER_REVIEW')",
            fetchone=True)["c"],
        "documents_expiring_soon": query(
            """SELECT COUNT(*) c FROM doctor_documents
               WHERE expiry_date IS NOT NULL AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)""",
            fetchone=True)["c"],
        "clinics_pending_verification": query(
            "SELECT COUNT(*) c FROM clinics WHERE approval_status='PENDING'", fetchone=True)["c"],
        "doctors_approved_today": query(
            "SELECT COUNT(*) c FROM doctor_applications WHERE status='APPROVED' AND DATE(reviewed_at)=CURDATE()",
            fetchone=True)["c"],
    }
    return jsonify({
        "action_required_count": action_required_count,
        "alerts": alerts,
        "counts": counts,
    })
