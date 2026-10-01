from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit
from app.services import matching

bp = Blueprint("admin_matching", __name__, url_prefix="/api/admin")


def _doctor_matching_inputs(doctor=None, application=None):
    src = doctor or application or {}
    return {
        "doctor_specialization": src.get("specialization"),
        "doctor_city_id": src.get("city_id"),
        "doctor_area_id": src.get("area_id"),
        "doctor_lat": src.get("latitude"),
        "doctor_lon": src.get("longitude"),
    }


# ==================== Recommendation Engine ====================
@bp.get("/doctors/<int:doctor_id>/recommended-organizations")
@require_auth(["admin"])
def recommended_organizations_for_doctor(doctor_id):
    doctor = query("SELECT * FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404
    existing = [r["clinic_id"] for r in query(
        "SELECT clinic_id FROM clinic_doctors WHERE doctor_id=%s AND status='active'", (doctor_id,)
    )]
    limit = request.args.get("limit", 10, type=int)
    results = matching.recommend_organizations(
        **_doctor_matching_inputs(doctor=doctor), limit=limit, exclude_clinic_ids=existing,
    )
    matching.persist_recommendations(results, doctor_id=doctor_id)
    return jsonify({"doctor_id": doctor_id, "recommendations": results})


@bp.get("/applications/<int:app_id>/recommended-organizations")
@require_auth(["admin"])
def recommended_organizations_for_application(app_id):
    application = query("SELECT * FROM doctor_applications WHERE id=%s", (app_id,), fetchone=True)
    if not application:
        return jsonify({"error": "Application not found"}), 404
    limit = request.args.get("limit", 10, type=int)
    inputs = _doctor_matching_inputs(application=application)
    # applications store location under city_id/area_id (doctor's own location),
    # separate from clinic_city_id/clinic_area_id (the proposed organization).
    results = matching.recommend_organizations(**inputs, limit=limit)
    matching.persist_recommendations(results, application_id=app_id)
    return jsonify({"application_id": app_id, "recommendations": results})


@bp.get("/organizations/<int:clinic_id>/match-explanation")
@require_auth(["admin"])
def match_explanation(clinic_id):
    """'Why was this recommended' drill-down for a single organization,
    against either a doctor_id or an application_id supplied as a query param."""
    doctor_id = request.args.get("doctor_id", type=int)
    application_id = request.args.get("application_id", type=int)
    src = None
    if doctor_id:
        src = query("SELECT * FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
    elif application_id:
        src = query("SELECT * FROM doctor_applications WHERE id=%s", (application_id,), fetchone=True)
    if not src:
        return jsonify({"error": "doctor_id or application_id is required and must exist"}), 400
    result = matching.score_organization(clinic_id, **_doctor_matching_inputs(doctor=src))
    if not result:
        return jsonify({"error": "Organization not found"}), 404
    return jsonify(result)


@bp.get("/match-weights")
@require_auth(["admin"])
def get_match_weights():
    return jsonify(query("SELECT * FROM match_weight_profiles WHERE id=1", fetchone=True))


@bp.put("/match-weights")
@require_auth(["admin"])
def update_match_weights():
    data = request.get_json(force=True) or {}
    fields = [
        "location_weight", "specialization_weight", "availability_weight",
        "capacity_weight", "distance_weight", "doctor_distribution_weight",
    ]
    current = query("SELECT * FROM match_weight_profiles WHERE id=1", fetchone=True)
    merged_total = sum(float(data.get(f, current[f])) for f in fields)
    if round(merged_total) != 100:
        return jsonify({"error": f"Weights must sum to 100 (received {merged_total})"}), 400
    updates, params = [], []
    for f in fields:
        if f in data:
            updates.append(f"{f}=%s"); params.append(data[f])
    if not updates:
        return jsonify({"error": "No weight fields provided"}), 400
    params.append(g.user_id)
    execute(f"UPDATE match_weight_profiles SET {', '.join(updates)}, updated_by_admin_id=%s WHERE id=1", params)
    add_audit(g.user_id, "admin", "MATCH_WEIGHTS_UPDATED", str(data))
    return jsonify(query("SELECT * FROM match_weight_profiles WHERE id=1", fetchone=True))


# ==================== Healthcare Map ====================
@bp.get("/map/data")
@require_auth(["admin"])
def map_data():
    """Aggregated marker data for the interactive map. Deliberately excludes
    patient-identifying detail — patient markers are location-anonymized
    counts only, never individual patient records."""
    city_id = request.args.get("city_id", type=int)
    specialization = request.args.get("specialization")
    verified_only = request.args.get("verified_only") == "true"

    clinic_where, clinic_params = ["c.status='active'"], []
    if city_id:
        clinic_where.append("c.city_id=%s"); clinic_params.append(city_id)
    if verified_only:
        clinic_where.append("c.approval_status='APPROVED'")
    clinics = query(
        f"""SELECT c.id, c.name, c.org_type, c.latitude, c.longitude, c.approval_status, c.status,
                   ci.name AS city_name
            FROM clinics c LEFT JOIN cities ci ON ci.id = c.city_id
            WHERE {' AND '.join(clinic_where)} AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL""",
        clinic_params,
    )

    doctor_where, doctor_params = ["d.is_active=1"], []
    if specialization:
        doctor_where.append("d.specialization=%s"); doctor_params.append(specialization)
    if verified_only:
        doctor_where.append("d.verification_status='APPROVED'")
    doctors = query(
        f"""SELECT d.id, d.full_name, d.specialization, d.latitude, d.longitude, d.verification_status
            FROM doctors d WHERE {' AND '.join(doctor_where)} AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL""",
        doctor_params,
    )

    return jsonify({"clinics": clinics, "doctors": doctors})


@bp.get("/map/organizations/<int:clinic_id>")
@require_auth(["admin"])
def map_organization_detail(clinic_id):
    from app.services.capacity import compute_clinic_capacity
    clinic = query("SELECT * FROM clinics WHERE id=%s", (clinic_id,), fetchone=True)
    if not clinic:
        return jsonify({"error": "Organization not found"}), 404
    capacity = compute_clinic_capacity(clinic_id)
    rating = query(
        "SELECT AVG(rating) avg_rating FROM feedback WHERE clinic_id=%s", (clinic_id,), fetchone=True
    )
    return jsonify({
        "clinic": clinic,
        "capacity": capacity,
        "avg_rating": round(float(rating["avg_rating"]), 2) if rating["avg_rating"] is not None else None,
    })


@bp.get("/map/doctors/<int:doctor_id>")
@require_auth(["admin"])
def map_doctor_detail(doctor_id):
    doctor = query("SELECT * FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404
    organizations = query(
        "SELECT clinic_id FROM clinic_doctors WHERE doctor_id=%s AND status='active'", (doctor_id,)
    )
    today_count = query(
        "SELECT COUNT(*) c FROM appointments WHERE doctor_id=%s AND appointment_date=CURDATE()",
        (doctor_id,), fetchone=True,
    )["c"]
    from app.services.performance import get_score_with_trend
    perf = get_score_with_trend(doctor_id)
    return jsonify({
        "doctor": {
            "id": doctor["id"], "full_name": doctor["full_name"], "specialization": doctor["specialization"],
            "verification_status": doctor["verification_status"],
        },
        "organization_count": len(organizations),
        "appointments_today": today_count,
        "performance_score": perf["current"]["overall_score"] if perf else None,
    })
