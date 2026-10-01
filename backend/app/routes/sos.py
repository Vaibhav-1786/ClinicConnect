from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit, add_notification

bp = Blueprint("sos", __name__, url_prefix="/api/sos")


def _home_clinic(patient_id):
    """Best-effort 'home clinic' = clinic of the patient's most recent appointment."""
    return query(
        """SELECT c.id, c.name, c.contact_number, c.address
           FROM appointments a JOIN clinics c ON c.id = a.clinic_id
           WHERE a.patient_id=%s ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT 1""",
        (patient_id,), fetchone=True,
    )


@bp.get("/contact")
@require_auth(["patient"])
def emergency_contact():
    """Returns the clinic to call, so the SOS button can show a number
    immediately without waiting on a location fix."""
    clinic = _home_clinic(g.profile_id)
    patient = query("SELECT emergency_contact FROM patients WHERE id=%s", (g.profile_id,), fetchone=True)
    return jsonify({
        "clinic": clinic,
        "patient_emergency_contact": patient.get("emergency_contact") if patient else None,
    })


@bp.post("")
@require_auth(["patient"])
def raise_alert():
    data = request.get_json(force=True) or {}
    clinic = _home_clinic(g.profile_id)
    clinic_id = clinic["id"] if clinic else None

    alert_id = execute(
        "INSERT INTO sos_alerts (patient_id, clinic_id, latitude, longitude) VALUES (%s,%s,%s,%s)",
        (g.profile_id, clinic_id, data.get("latitude"), data.get("longitude")),
    )
    if clinic_id:
        staff = query(
            """SELECT u.id AS user_id FROM receptionists r JOIN users u ON u.id = r.user_id
               WHERE r.clinic_id=%s""",
            (clinic_id,),
        )
        patient = query("SELECT full_name FROM patients WHERE id=%s", (g.profile_id,), fetchone=True)
        for s in staff:
            add_notification(
                s["user_id"], "sos", "🚨 Patient SOS alert",
                f"{patient['full_name'] if patient else 'A patient'} has raised an emergency alert. Contact them immediately.",
            )
    add_audit(g.user_id, "patient", "SOS_ALERT_RAISED", f"#{alert_id}")
    return jsonify({
        "alert_id": alert_id,
        "clinic": clinic,
    }), 201


@bp.get("/mine")
@require_auth(["patient"])
def my_alerts():
    return jsonify(query(
        "SELECT * FROM sos_alerts WHERE patient_id=%s ORDER BY created_at DESC", (g.profile_id,),
    ))
