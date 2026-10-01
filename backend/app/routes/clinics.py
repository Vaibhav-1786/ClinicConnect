from flask import Blueprint, request, jsonify

from app.utils.db import query

bp = Blueprint("clinics", __name__, url_prefix="/api")


@bp.get("/clinics")
def list_clinics():
    """Filter by state_id/city_id/area_id (progressive discovery) and optional specialization/search."""
    state_id = request.args.get("state_id")
    city_id = request.args.get("city_id")
    area_id = request.args.get("area_id")
    search = request.args.get("search")

    sql = """
        SELECT c.id, c.name, c.type, c.address, c.contact_number, c.email,
               c.opening_time, c.closing_time, c.status,
               s.name AS state_name, ci.name AS city_name, a.name AS area_name
        FROM clinics c
        JOIN states s ON s.id = c.state_id
        JOIN cities ci ON ci.id = c.city_id
        JOIN areas a ON a.id = c.area_id
        WHERE c.status = 'active'
    """
    params = []
    if state_id:
        sql += " AND c.state_id=%s"; params.append(state_id)
    if city_id:
        sql += " AND c.city_id=%s"; params.append(city_id)
    if area_id:
        sql += " AND c.area_id=%s"; params.append(area_id)
    if search:
        sql += " AND c.name LIKE %s"; params.append(f"%{search}%")
    sql += " ORDER BY c.name"

    clinics = query(sql, params)
    for c in clinics:
        docs = query(
            """SELECT d.id, d.full_name, d.specialization, d.consultation_fee
               FROM clinic_doctors cd JOIN doctors d ON d.id = cd.doctor_id
               WHERE cd.clinic_id=%s""",
            (c["id"],),
        )
        c["doctors"] = docs
        c["specializations"] = sorted({d["specialization"] for d in docs if d["specialization"]})
    return jsonify(clinics)


@bp.get("/clinics/<int:clinic_id>")
def get_clinic(clinic_id):
    clinic = query(
        """SELECT c.*, s.name AS state_name, ci.name AS city_name, a.name AS area_name
           FROM clinics c JOIN states s ON s.id=c.state_id
           JOIN cities ci ON ci.id=c.city_id JOIN areas a ON a.id=c.area_id
           WHERE c.id=%s""",
        (clinic_id,), fetchone=True,
    )
    if not clinic:
        return jsonify({"error": "Clinic not found"}), 404
    clinic["doctors"] = query(
        """SELECT d.id, d.full_name, d.specialization, d.consultation_fee, d.qualification, d.experience_years
           FROM clinic_doctors cd JOIN doctors d ON d.id = cd.doctor_id WHERE cd.clinic_id=%s""",
        (clinic_id,),
    )
    return jsonify(clinic)


@bp.get("/doctors")
def list_doctors():
    search = request.args.get("search")
    specialization = request.args.get("specialization")
    city_id = request.args.get("city_id")

    sql = """
        SELECT DISTINCT d.id, d.full_name, d.specialization, d.qualification,
               d.experience_years, d.consultation_fee
        FROM doctors d
        LEFT JOIN clinic_doctors cd ON cd.doctor_id = d.id
        LEFT JOIN clinics c ON c.id = cd.clinic_id
        WHERE 1=1
    """
    params = []
    if search:
        sql += " AND d.full_name LIKE %s"; params.append(f"%{search}%")
    if specialization:
        sql += " AND d.specialization = %s"; params.append(specialization)
    if city_id:
        sql += " AND c.city_id = %s"; params.append(city_id)
    sql += " ORDER BY d.full_name"
    return jsonify(query(sql, params))


@bp.get("/doctors/<int:doctor_id>")
def get_doctor(doctor_id):
    doc = query("SELECT * FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
    if not doc:
        return jsonify({"error": "Doctor not found"}), 404
    doc["clinics"] = query(
        """SELECT c.id, c.name, c.address FROM clinic_doctors cd
           JOIN clinics c ON c.id = cd.clinic_id WHERE cd.doctor_id=%s""",
        (doctor_id,),
    )
    return jsonify(doc)
