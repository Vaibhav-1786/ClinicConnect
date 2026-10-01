"""
Patient 360° Profile (spec section 5).

Read-only aggregation across existing tables: personal info, medical
history, allergies, medications, diagnoses, visits, prescriptions, lab
reports, documents, payments, appointments and follow-ups — plus a
quick clinical summary block at the top. No new tables are needed;
this mirrors data that already has its own dedicated pages/endpoints
(kept working unchanged) and simply presents it together.
"""
from flask import Blueprint, jsonify, g

from app.utils.db import query
from app.utils.auth import require_auth

bp = Blueprint("patient_360", __name__, url_prefix="/api/patients")


def _can_access(patient_id):
    if g.role == "patient":
        return patient_id == g.profile_id
    if g.role == "admin":
        return True
    if g.role == "doctor":
        # Doctor may view any patient they have (or had) an appointment with.
        row = query(
            "SELECT id FROM appointments WHERE doctor_id=%s AND patient_id=%s LIMIT 1",
            (g.profile_id, patient_id), fetchone=True,
        )
        return row is not None
    if g.role == "receptionist":
        row = query(
            "SELECT id FROM appointments WHERE clinic_id=%s AND patient_id=%s LIMIT 1",
            (g.clinic_id, patient_id), fetchone=True,
        )
        return row is not None
    return False


@bp.get("/<int:patient_id>/profile-360")
@require_auth(["patient", "doctor", "receptionist", "admin"])
def profile_360(patient_id):
    if not _can_access(patient_id):
        return jsonify({"error": "Forbidden"}), 403

    patient = query(
        """SELECT p.*, s.name AS state_name, c.name AS city_name, a.name AS area_name
           FROM patients p
           LEFT JOIN states s ON s.id = p.state_id
           LEFT JOIN cities c ON c.id = p.city_id
           LEFT JOIN areas a ON a.id = p.area_id
           WHERE p.id=%s""",
        (patient_id,), fetchone=True,
    )
    if not patient:
        return jsonify({"error": "Patient not found"}), 404

    appointments = query(
        """SELECT a.*, d.full_name AS doctor_name, c.name AS clinic_name
           FROM appointments a JOIN doctors d ON d.id=a.doctor_id JOIN clinics c ON c.id=a.clinic_id
           WHERE a.patient_id=%s ORDER BY a.appointment_date DESC, a.appointment_time DESC""",
        (patient_id,),
    )
    diagnoses = query(
        """SELECT dg.*, d.full_name AS doctor_name FROM diagnoses dg
           JOIN doctors d ON d.id = dg.doctor_id WHERE dg.patient_id=%s ORDER BY dg.created_at DESC""",
        (patient_id,),
    )
    prescriptions = query(
        """SELECT p.*, d.full_name AS doctor_name FROM prescriptions p
           JOIN doctors d ON d.id = p.doctor_id WHERE p.patient_id=%s ORDER BY p.prescription_date DESC""",
        (patient_id,),
    )
    active_medications = []
    if prescriptions:
        latest_ids = [p["id"] for p in prescriptions[:5]]
        placeholders = ",".join(["%s"] * len(latest_ids))
        active_medications = query(
            f"""SELECT pi.*, COALESCE(pi.medicine_name, m.name) AS medicine_name FROM prescription_items pi
                LEFT JOIN medicines m ON m.id = pi.medicine_id
                WHERE pi.prescription_id IN ({placeholders})
                AND (pi.end_date IS NULL OR pi.end_date >= CURDATE())""",
            latest_ids,
        )
    lab_reports = query(
        """SELECT lr.*, lt.name AS test_name, lo.status AS order_status FROM lab_reports lr
           JOIN lab_orders lo ON lo.id = lr.lab_order_id
           JOIN lab_tests lt ON lt.id = lo.lab_test_id
           WHERE lo.patient_id=%s ORDER BY lr.reported_at DESC""",
        (patient_id,),
    )
    documents = query(
        "SELECT * FROM documents WHERE patient_id=%s AND is_latest=1 ORDER BY created_at DESC", (patient_id,),
    )
    invoices = query(
        "SELECT * FROM invoices WHERE patient_id=%s ORDER BY created_at DESC", (patient_id,),
    )
    followups = query(
        """SELECT f.*, d.full_name AS doctor_name FROM followups f
           JOIN doctors d ON d.id = f.doctor_id WHERE f.patient_id=%s ORDER BY f.followup_date DESC""",
        (patient_id,),
    )
    latest_vitals = query(
        "SELECT * FROM vitals WHERE patient_id=%s ORDER BY recorded_at DESC LIMIT 1", (patient_id,), fetchone=True,
    )

    outstanding_balance = sum(
        float(inv["total_amount"]) for inv in invoices
        if inv["payment_status"] in ("Pending", "Partially Paid")
    )
    next_appointment = next(
        (a for a in appointments if a["status"] in ("CONFIRMED", "CHECKED_IN", "IN_CONSULTATION")), None,
    )
    last_visit = next((a for a in appointments if a["status"] == "COMPLETED"), None)
    pending_followup = next((f for f in followups if f["status"] == "pending"), None)

    summary = {
        "patient_name": patient["full_name"],
        "patient_code": patient["patient_code"],
        "blood_group": patient["blood_group"],
        "critical_allergies": patient["allergies"],
        "active_medication_count": len(active_medications),
        "important_conditions": [d["diagnosis_text"] for d in diagnoses[:3]],
        "recent_vitals": latest_vitals,
        "last_visit_date": last_visit["appointment_date"] if last_visit else None,
        "next_appointment_date": next_appointment["appointment_date"] if next_appointment else None,
        "outstanding_balance": round(outstanding_balance, 2),
        "pending_follow_up": pending_followup["followup_date"] if pending_followup else None,
    }

    return jsonify({
        "summary": summary,
        "personal_information": patient,
        "medical_history": {"diagnoses": diagnoses, "allergies": patient["allergies"]},
        "medications": {"active": active_medications, "all_prescriptions": prescriptions},
        "visits": appointments,
        "appointments": appointments,
        "lab_reports": lab_reports,
        "documents": documents,
        "payments": invoices,
        "follow_ups": followups,
    })
