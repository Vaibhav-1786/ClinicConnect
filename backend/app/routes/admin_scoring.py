from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit
from app.services.performance import compute_and_store_doctor_score, get_score_with_trend
from app.services.capacity import (
    compute_clinic_capacity, snapshot_clinic_capacity, capacity_trend, overloaded_clinics,
)
from app.services.risk import compute_and_store_risk, get_latest_risk
from app.services.forecast import forecast_appointments

bp = Blueprint("admin_scoring", __name__, url_prefix="/api/admin")


# ==================== Doctor Performance Score (feature 4) ====================
@bp.get("/doctors/<int:doctor_id>/performance-score")
@require_auth(["admin"])
def doctor_performance_score(doctor_id):
    doctor = query("SELECT id FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404
    trend = get_score_with_trend(doctor_id)
    if not trend:
        # No score computed yet for this doctor — compute one now on first view.
        compute_and_store_doctor_score(doctor_id)
        trend = get_score_with_trend(doctor_id)
    return jsonify(trend)


@bp.post("/doctors/<int:doctor_id>/performance-score/recompute")
@require_auth(["admin"])
def recompute_doctor_performance_score(doctor_id):
    result = compute_and_store_doctor_score(doctor_id)
    if result is None:
        return jsonify({"error": "Doctor not found"}), 404
    add_audit(g.user_id, "admin", "DOCTOR_PERFORMANCE_RECOMPUTED", f"Doctor #{doctor_id}")
    return jsonify(result)


@bp.post("/performance-scores/recompute-all")
@require_auth(["admin"])
def recompute_all_performance_scores():
    """Batch recompute — intended to be called from a daily scheduled job,
    but exposed as an explicit admin-triggered endpoint too."""
    doctor_ids = [r["id"] for r in query("SELECT id FROM doctors WHERE is_active=1")]
    updated = 0
    for doctor_id in doctor_ids:
        if compute_and_store_doctor_score(doctor_id):
            updated += 1
    add_audit(g.user_id, "admin", "DOCTOR_PERFORMANCE_RECOMPUTED", f"Batch: {updated} doctors")
    return jsonify({"updated": updated, "total": len(doctor_ids)})


# ==================== Clinic Capacity Dashboard (feature 7) ====================
@bp.get("/clinics/<int:clinic_id>/capacity")
@require_auth(["admin"])
def clinic_capacity(clinic_id):
    result = compute_clinic_capacity(clinic_id)
    if result is None:
        return jsonify({"error": "Clinic not found"}), 404
    result["trend"] = capacity_trend(clinic_id, days=7)
    return jsonify(result)


@bp.post("/clinics/<int:clinic_id>/capacity/snapshot")
@require_auth(["admin"])
def clinic_capacity_snapshot(clinic_id):
    result = snapshot_clinic_capacity(clinic_id)
    if result is None:
        return jsonify({"error": "Clinic not found"}), 404
    return jsonify(result)


@bp.get("/clinics/capacity/overloaded")
@require_auth(["admin"])
def clinics_overloaded():
    threshold = request.args.get("threshold", 90.0, type=float)
    return jsonify(overloaded_clinics(threshold_pct=threshold))


# ==================== Application Risk Score (feature 20) ====================
@bp.get("/applications/<int:app_id>/risk-score")
@require_auth(["admin"])
def application_risk_score(app_id):
    application = query("SELECT id FROM doctor_applications WHERE id=%s", (app_id,), fetchone=True)
    if not application:
        return jsonify({"error": "Application not found"}), 404
    latest = get_latest_risk(app_id)
    if not latest:
        result = compute_and_store_risk(app_id)
        return jsonify(result)
    return jsonify({
        "risk_score": float(latest["risk_score"]), "risk_level": latest["risk_level"],
        "factors": latest["factors"], "computed_at": latest["computed_at"],
    })


@bp.post("/applications/<int:app_id>/risk-score/recompute")
@require_auth(["admin"])
def recompute_application_risk(app_id):
    result = compute_and_store_risk(app_id)
    if result is None:
        return jsonify({"error": "Application not found"}), 404
    add_audit(g.user_id, "admin", "APPLICATION_RISK_RECOMPUTED", f"Application #{app_id}")
    return jsonify(result)


# ==================== Predictive Appointment Analytics (feature 17) ====================
@bp.get("/forecast/appointments")
@require_auth(["admin"])
def appointment_forecast():
    scope_type = request.args.get("scope_type", "GLOBAL").upper()
    scope_value = request.args.get("scope_value")
    if scope_type not in ("GLOBAL", "CITY", "SPECIALIZATION", "CLINIC"):
        return jsonify({"error": "scope_type must be one of GLOBAL, CITY, SPECIALIZATION, CLINIC"}), 400
    result = forecast_appointments(scope_type, scope_value)
    if result is None:
        return jsonify({"error": "Not enough historical data to forecast"}), 200
    return jsonify(result)


# ==================== Gamified Admin Productivity (feature 19) ====================
@bp.get("/productivity/settings")
@require_auth(["admin"])
def productivity_settings():
    return jsonify(query("SELECT * FROM admin_productivity_settings WHERE id=1", fetchone=True))


@bp.put("/productivity/settings")
@require_auth(["admin"])
def update_productivity_settings():
    data = request.get_json(force=True) or {}
    is_enabled = 1 if data.get("is_enabled") else 0
    execute(
        "UPDATE admin_productivity_settings SET is_enabled=%s, updated_by_admin_id=%s WHERE id=1",
        (is_enabled, g.user_id),
    )
    add_audit(g.user_id, "admin", "ADMIN_PRODUCTIVITY_SETTING_CHANGED", f"is_enabled={is_enabled}")
    return jsonify({"is_enabled": bool(is_enabled)})


@bp.get("/productivity/leaderboard")
@require_auth(["admin"])
def productivity_leaderboard():
    settings = query("SELECT is_enabled FROM admin_productivity_settings WHERE id=1", fetchone=True)
    if not settings or not settings["is_enabled"]:
        return jsonify({"enabled": False, "rows": []})

    rows = query(
        """SELECT u.id AS admin_id, u.email,
                  COUNT(*) AS applications_processed,
                  SUM(CASE WHEN da.status='APPROVED' THEN 1 ELSE 0 END) AS approved,
                  SUM(CASE WHEN da.status='REJECTED' THEN 1 ELSE 0 END) AS rejected,
                  AVG(TIMESTAMPDIFF(MINUTE, da.created_at, da.reviewed_at)) AS avg_review_minutes
           FROM doctor_applications da
           JOIN users u ON u.id = da.reviewed_by_admin_id
           WHERE da.reviewed_at IS NOT NULL
                 AND da.reviewed_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           GROUP BY u.id, u.email
           ORDER BY applications_processed DESC"""
    )
    for r in rows:
        r["avg_review_minutes"] = round(float(r["avg_review_minutes"]), 1) if r["avg_review_minutes"] is not None else None
        r["accuracy_pct"] = (
            round((r["approved"] / r["applications_processed"]) * 100, 1)
            if r["applications_processed"] else None
        )
    return jsonify({"enabled": True, "rows": rows})
