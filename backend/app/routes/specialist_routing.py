from flask import Blueprint, request, jsonify, g

from app.utils.db import query
from app.utils.auth import require_auth

bp = Blueprint("specialist_routing", __name__, url_prefix="/api/specialist-routing")

DISCLAIMER = (
    "This tool only helps you find a relevant specialist or department — it is not a medical "
    "diagnosis. If you're experiencing a medical emergency, please seek immediate emergency care."
)

# Rule-based category -> keyword mapping. `doctors.specialization` is a free-text
# field (there is no fixed enum in the schema), so matching is done with a
# case-insensitive LIKE against these keywords rather than an exact value —
# this is intentionally simple and auditable, not a machine-learned classifier,
# so there is nothing here that could be mistaken for a diagnostic system.
CATEGORIES = {
    "dental": {"label": "Dental", "keywords": ["dental", "dentist", "orthodont"]},
    "skin": {"label": "Skin", "keywords": ["derma", "skin"]},
    "eye": {"label": "Eye", "keywords": ["ophthal", "eye", "optometr"]},
    "bone_joint": {"label": "Bone/Joint", "keywords": ["ortho", "bone", "joint"]},
    "heart": {"label": "Heart", "keywords": ["cardio", "heart"]},
    "child_care": {"label": "Child care", "keywords": ["pediatric", "paediatric", "child"]},
    "womens_health": {"label": "Women's health", "keywords": ["gynec", "gynaec", "obstetric", "women"]},
    "general": {"label": "General consultation", "keywords": ["general", "family medicine", "physician"]},
    "physiotherapy": {"label": "Physiotherapy", "keywords": ["physio"]},
    "mental_wellness": {"label": "Mental wellness", "keywords": ["psychiat", "psycholog", "mental", "counsel"]},
}


@bp.get("/categories")
def list_categories():
    return jsonify([{"key": k, "label": v["label"]} for k, v in CATEGORIES.items()])


@bp.get("/search")
@require_auth(["patient"])
def search_by_category():
    category = request.args.get("category")
    if category not in CATEGORIES:
        return jsonify({"error": f"category must be one of {', '.join(CATEGORIES)}"}), 400

    keywords = CATEGORIES[category]["keywords"]
    like_clause = " OR ".join(["d.specialization LIKE %s"] * len(keywords))
    params = [f"%{kw}%" for kw in keywords]

    # Location filtering: the patient's own profile city, looked up
    # server-side — never a state_id/city_id/area_id the client might send
    # (see spec section 11: patients must not be able to retrieve another
    # city's results by tampering with a request parameter).
    patient = query("SELECT city_id FROM patients WHERE id=%s", (g.profile_id,), fetchone=True)
    if not patient or not patient.get("city_id"):
        return jsonify({"error": "No location set on your profile yet. Please set your city in your profile."}), 400

    sql = f"""SELECT DISTINCT d.id, d.full_name, d.specialization, d.qualification, d.experience_years,
                     d.consultation_fee, c.id AS clinic_id, c.name AS clinic_name, c.org_type,
                     c.address, c.area_id, c.city_id, c.state_id
              FROM doctors d
              JOIN clinic_doctors cd ON cd.doctor_id = d.id AND cd.status='active'
              JOIN clinics c ON c.id = cd.clinic_id
              WHERE d.is_active=1 AND d.verification_status='APPROVED'
                    AND c.status='active' AND c.approval_status='APPROVED'
                    AND c.city_id=%s
                    AND ({like_clause})"""
    params = [patient["city_id"], *params]
    sql += " ORDER BY c.name, d.full_name"

    results = query(sql, params)
    matched_specializations = sorted({r["specialization"] for r in results if r["specialization"]})

    return jsonify({
        "category": CATEGORIES[category]["label"],
        "disclaimer": DISCLAIMER,
        "matched_specializations": matched_specializations,
        "results": results,
    })
