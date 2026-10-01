from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.services.slots import generate_slots

bp = Blueprint("availability", __name__, url_prefix="/api")


@bp.get("/doctors/<int:doctor_id>/availability")
def doctor_availability_slots(doctor_id):
    """Public: given doctor_id, clinic_id, date -> return generated slots."""
    clinic_id = request.args.get("clinic_id")
    date_str = request.args.get("date")
    if not clinic_id or not date_str:
        return jsonify({"error": "clinic_id and date are required"}), 400
    return jsonify({"slots": generate_slots(int(doctor_id), int(clinic_id), date_str)})


@bp.get("/doctor/availability")
@require_auth(["doctor"])
def my_availability():
    # Availability is stored per Doctor + Clinic/Hospital, so only the
    # currently-selected organization's schedule is returned here.
    rows = query(
        """SELECT da.id, da.clinic_id, c.name AS clinic_name, da.day_of_week, da.start_time, da.end_time
           FROM doctor_availability da JOIN clinics c ON c.id = da.clinic_id
           WHERE da.doctor_id=%s AND da.clinic_id=%s ORDER BY da.day_of_week""",
        (g.profile_id, g.clinic_id),
    )
    leaves = query("SELECT id, leave_date, reason FROM doctor_leaves WHERE doctor_id=%s ORDER BY leave_date", (g.profile_id,))
    return jsonify({"availability": rows, "leaves": leaves})


@bp.post("/doctor/availability")
@require_auth(["doctor"])
def set_availability():
    data = request.get_json(force=True) or {}
    required = ["day_of_week", "start_time", "end_time"]
    if any(f not in data for f in required):
        return jsonify({"error": "Missing fields"}), 400
    # A doctor may only set availability for the clinic/hospital they're
    # currently logged into — never for an unrelated organization.
    clinic_id = g.clinic_id
    new_id = execute(
        """INSERT INTO doctor_availability (doctor_id, clinic_id, day_of_week, start_time, end_time)
           VALUES (%s,%s,%s,%s,%s)""",
        (g.profile_id, clinic_id, data["day_of_week"], data["start_time"], data["end_time"]),
    )
    return jsonify({"id": new_id}), 201


@bp.delete("/doctor/availability/<int:availability_id>")
@require_auth(["doctor"])
def delete_availability(availability_id):
    execute(
        "DELETE FROM doctor_availability WHERE id=%s AND doctor_id=%s AND clinic_id=%s",
        (availability_id, g.profile_id, g.clinic_id),
    )
    return jsonify({"message": "Deleted"})


@bp.post("/doctor/leaves")
@require_auth(["doctor"])
def add_leave():
    data = request.get_json(force=True) or {}
    if not data.get("leave_date"):
        return jsonify({"error": "leave_date required"}), 400
    new_id = execute(
        "INSERT INTO doctor_leaves (doctor_id, leave_date, reason) VALUES (%s,%s,%s)",
        (g.profile_id, data["leave_date"], data.get("reason", "")),
    )
    return jsonify({"id": new_id}), 201


@bp.delete("/doctor/leaves/<int:leave_id>")
@require_auth(["doctor"])
def delete_leave(leave_id):
    execute("DELETE FROM doctor_leaves WHERE id=%s AND doctor_id=%s", (leave_id, g.profile_id))
    return jsonify({"message": "Deleted"})
