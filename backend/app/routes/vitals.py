from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth

bp = Blueprint("vitals", __name__, url_prefix="/api/vitals")


@bp.post("")
@require_auth(["doctor", "receptionist"])
def record_vitals():
    data = request.get_json(force=True) or {}
    if not data.get("patient_id"):
        return jsonify({"error": "patient_id required"}), 400
    new_id = execute(
        """INSERT INTO vitals (patient_id, appointment_id, recorded_by, blood_pressure, weight_kg,
           blood_sugar, temperature_f, pulse, spo2)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (data["patient_id"], data.get("appointment_id"), g.user_id, data.get("blood_pressure"),
         data.get("weight_kg"), data.get("blood_sugar"), data.get("temperature_f"),
         data.get("pulse"), data.get("spo2")),
    )
    return jsonify({"id": new_id}), 201


@bp.get("/patient/<int:patient_id>")
@require_auth(["doctor", "receptionist", "patient"])
def patient_vitals(patient_id):
    if g.role == "patient" and g.profile_id != patient_id:
        return jsonify({"error": "Forbidden"}), 403
    return jsonify(query(
        "SELECT * FROM vitals WHERE patient_id=%s ORDER BY recorded_at DESC", (patient_id,)
    ))
