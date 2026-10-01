"""
GET /api/patient/hospitals

Replaces the old "search any city/state/area" flow for patients: what a
patient sees is now determined entirely by their own profile location,
looked up server-side from the authenticated patient row — never from a
city_id/state_id/area_id the frontend might send. This is the backend
enforcement point spec section 3 and 11 require: a patient cannot get
another city's hospitals by tampering with a query parameter, because no
such parameter is ever read here.
"""
from flask import Blueprint, jsonify, g

from app.utils.db import query
from app.utils.auth import require_auth

bp = Blueprint("patient_hospitals", __name__, url_prefix="/api/patient")


@bp.get("/hospitals")
@require_auth(["patient"])
def list_hospitals_for_patient():
    patient = query(
        "SELECT id, city_id FROM patients WHERE id=%s", (g.profile_id,), fetchone=True,
    )
    if not patient or not patient.get("city_id"):
        return jsonify({
            "error": "No location set on your profile yet. Please set your city in your profile.",
            "city_id": None,
            "clinics": [],
        }), 400

    clinics = query(
        """SELECT c.id, c.name, c.type, c.address, c.contact_number, c.email,
                  c.opening_time, c.closing_time, c.status,
                  s.name AS state_name, ci.name AS city_name, a.name AS area_name
           FROM clinics c
           JOIN states s ON s.id = c.state_id
           JOIN cities ci ON ci.id = c.city_id
           JOIN areas a ON a.id = c.area_id
           WHERE c.status = 'active' AND c.city_id = %s
           ORDER BY c.name""",
        (patient["city_id"],),
    )
    for c in clinics:
        docs = query(
            """SELECT d.id, d.full_name, d.specialization, d.consultation_fee
               FROM clinic_doctors cd JOIN doctors d ON d.id = cd.doctor_id
               WHERE cd.clinic_id=%s AND cd.status='active'""",
            (c["id"],),
        )
        c["doctors"] = docs
        c["specializations"] = sorted({d["specialization"] for d in docs if d["specialization"]})

    city = query("SELECT id, name FROM cities WHERE id=%s", (patient["city_id"],), fetchone=True)
    return jsonify({"city": city, "clinics": clinics})
