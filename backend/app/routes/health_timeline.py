from flask import Blueprint, request, jsonify, g

from app.utils.db import query
from app.utils.auth import require_auth

bp = Blueprint("health_timeline", __name__, url_prefix="/api/patient/health-timeline")

VALID_TYPES = {"Appointment", "Consultation", "Prescription", "Vitals", "Lab Report", "Payment", "Vaccination", "Follow-up"}


def _filters():
    return {
        "date_from": request.args.get("date_from"),
        "date_to": request.args.get("date_to"),
        "doctor_id": request.args.get("doctor_id", type=int),
        "clinic_id": request.args.get("clinic_id", type=int),
        "family_member_id": request.args.get("family_member_id", type=int),
        "type": request.args.get("type"),
    }


def _date_clause(alias, f, params):
    clause = ""
    if f["date_from"]:
        clause += f" AND {alias} >= %s"; params.append(f["date_from"])
    if f["date_to"]:
        clause += f" AND {alias} <= %s"; params.append(f["date_to"])
    return clause


@bp.get("")
@require_auth(["patient"])
def get_timeline():
    f = _filters()
    if f["type"] and f["type"] not in VALID_TYPES:
        return jsonify({"error": f"type must be one of {', '.join(sorted(VALID_TYPES))}"}), 400

    events = []
    patient_id = g.profile_id

    # ---- Appointments / Consultations ----
    if not f["type"] or f["type"] in ("Appointment", "Consultation"):
        params = [patient_id]
        sql = """SELECT a.id, a.appointment_date, a.appointment_time, a.status, a.reason,
                         d.full_name AS doctor_name, c.name AS clinic_name, a.doctor_id, a.clinic_id,
                         a.family_member_id, fm.full_name AS family_member_name
                  FROM appointments a
                  JOIN doctors d ON d.id = a.doctor_id
                  JOIN clinics c ON c.id = a.clinic_id
                  LEFT JOIN family_members fm ON fm.id = a.family_member_id
                  WHERE a.patient_id=%s"""
        sql += _date_clause("a.appointment_date", f, params)
        if f["doctor_id"]:
            sql += " AND a.doctor_id=%s"; params.append(f["doctor_id"])
        if f["clinic_id"]:
            sql += " AND a.clinic_id=%s"; params.append(f["clinic_id"])
        if f["family_member_id"]:
            sql += " AND a.family_member_id=%s"; params.append(f["family_member_id"])
        for row in query(sql, params):
            kind = "Consultation" if row["status"] == "COMPLETED" else "Appointment"
            if f["type"] and f["type"] != kind:
                continue
            events.append({
                "event_type": kind, "event_date": str(row["appointment_date"]), "event_time": str(row["appointment_time"]),
                "title": f"{kind} with Dr. {row['doctor_name']}",
                "description": row["reason"] or "",
                "doctor_name": row["doctor_name"], "clinic_name": row["clinic_name"],
                "family_member_name": row["family_member_name"], "ref_id": row["id"], "status": row["status"],
            })

    # ---- Prescriptions ----
    if not f["type"] or f["type"] == "Prescription":
        params = [patient_id]
        sql = """SELECT p.id, p.prescription_date, p.diagnosis_text, d.full_name AS doctor_name,
                         c.name AS clinic_name, p.doctor_id, p.clinic_id, a.family_member_id, fm.full_name AS family_member_name
                  FROM prescriptions p
                  JOIN doctors d ON d.id = p.doctor_id
                  JOIN clinics c ON c.id = p.clinic_id
                  JOIN appointments a ON a.id = p.appointment_id
                  LEFT JOIN family_members fm ON fm.id = a.family_member_id
                  WHERE p.patient_id=%s"""
        sql += _date_clause("p.prescription_date", f, params)
        if f["doctor_id"]:
            sql += " AND p.doctor_id=%s"; params.append(f["doctor_id"])
        if f["clinic_id"]:
            sql += " AND p.clinic_id=%s"; params.append(f["clinic_id"])
        if f["family_member_id"]:
            sql += " AND a.family_member_id=%s"; params.append(f["family_member_id"])
        for row in query(sql, params):
            items = query(
                "SELECT COALESCE(pi.medicine_name, m.name) AS name FROM prescription_items pi LEFT JOIN medicines m ON m.id=pi.medicine_id WHERE pi.prescription_id=%s",
                (row["id"],),
            )
            med_names = ", ".join(i["name"] for i in items)
            events.append({
                "event_type": "Prescription", "event_date": str(row["prescription_date"]), "event_time": None,
                "title": "Prescription created",
                "description": med_names or (row["diagnosis_text"] or ""),
                "doctor_name": row["doctor_name"], "clinic_name": row["clinic_name"],
                "family_member_name": row["family_member_name"], "ref_id": row["id"], "status": None,
            })

    # ---- Vitals ----
    if not f["type"] or f["type"] == "Vitals":
        params = [patient_id]
        sql = """SELECT v.id, v.recorded_at, v.blood_pressure, v.weight_kg, v.pulse, v.spo2,
                         a.doctor_id, a.clinic_id, d.full_name AS doctor_name, c.name AS clinic_name,
                         a.family_member_id, fm.full_name AS family_member_name
                  FROM vitals v
                  LEFT JOIN appointments a ON a.id = v.appointment_id
                  LEFT JOIN doctors d ON d.id = a.doctor_id
                  LEFT JOIN clinics c ON c.id = a.clinic_id
                  LEFT JOIN family_members fm ON fm.id = a.family_member_id
                  WHERE v.patient_id=%s"""
        sql += _date_clause("DATE(v.recorded_at)", f, params)
        if f["doctor_id"]:
            sql += " AND a.doctor_id=%s"; params.append(f["doctor_id"])
        if f["clinic_id"]:
            sql += " AND a.clinic_id=%s"; params.append(f["clinic_id"])
        if f["family_member_id"]:
            sql += " AND a.family_member_id=%s"; params.append(f["family_member_id"])
        for row in query(sql, params):
            parts = []
            if row["blood_pressure"]: parts.append(f"BP {row['blood_pressure']}")
            if row["pulse"]: parts.append(f"Pulse {row['pulse']}")
            if row["spo2"]: parts.append(f"SpO2 {row['spo2']}%")
            if row["weight_kg"]: parts.append(f"Weight {row['weight_kg']}kg")
            events.append({
                "event_type": "Vitals", "event_date": str(row["recorded_at"])[:10], "event_time": None,
                "title": "Vitals recorded", "description": ", ".join(parts),
                "doctor_name": row["doctor_name"], "clinic_name": row["clinic_name"],
                "family_member_name": row["family_member_name"], "ref_id": row["id"], "status": None,
            })

    # ---- Lab Reports ----
    if not f["type"] or f["type"] == "Lab Report":
        params = [patient_id]
        sql = """SELECT lr.id, lr.reported_at, lr.result_value, lt.test_name,
                         lo.doctor_id, a.clinic_id, d.full_name AS doctor_name, c.name AS clinic_name,
                         a.family_member_id, fm.full_name AS family_member_name
                  FROM lab_reports lr
                  JOIN lab_orders lo ON lo.id = lr.lab_order_id
                  JOIN lab_tests lt ON lt.id = lo.lab_test_id
                  JOIN appointments a ON a.id = lo.appointment_id
                  JOIN doctors d ON d.id = lo.doctor_id
                  JOIN clinics c ON c.id = a.clinic_id
                  LEFT JOIN family_members fm ON fm.id = a.family_member_id
                  WHERE lo.patient_id=%s"""
        sql += _date_clause("DATE(lr.reported_at)", f, params)
        if f["doctor_id"]:
            sql += " AND lo.doctor_id=%s"; params.append(f["doctor_id"])
        if f["clinic_id"]:
            sql += " AND a.clinic_id=%s"; params.append(f["clinic_id"])
        if f["family_member_id"]:
            sql += " AND a.family_member_id=%s"; params.append(f["family_member_id"])
        for row in query(sql, params):
            events.append({
                "event_type": "Lab Report", "event_date": str(row["reported_at"])[:10], "event_time": None,
                "title": f"Lab report: {row['test_name']}", "description": row["result_value"] or "",
                "doctor_name": row["doctor_name"], "clinic_name": row["clinic_name"],
                "family_member_name": row["family_member_name"], "ref_id": row["id"], "status": None,
            })

    # ---- Payments ----
    if not f["type"] or f["type"] == "Payment":
        params = [patient_id]
        sql = """SELECT pay.id, pay.transaction_date, pay.amount, pay.method, i.clinic_id, c.name AS clinic_name,
                         a.family_member_id, fm.full_name AS family_member_name
                  FROM payments pay
                  JOIN invoices i ON i.id = pay.invoice_id
                  JOIN clinics c ON c.id = i.clinic_id
                  JOIN appointments a ON a.id = i.appointment_id
                  LEFT JOIN family_members fm ON fm.id = a.family_member_id
                  WHERE i.patient_id=%s"""
        sql += _date_clause("DATE(pay.transaction_date)", f, params)
        if f["clinic_id"]:
            sql += " AND i.clinic_id=%s"; params.append(f["clinic_id"])
        if f["family_member_id"]:
            sql += " AND a.family_member_id=%s"; params.append(f["family_member_id"])
        if not f["doctor_id"]:  # payments have no doctor association
            for row in query(sql, params):
                events.append({
                    "event_type": "Payment", "event_date": str(row["transaction_date"])[:10], "event_time": None,
                    "title": f"Payment of Rs.{row['amount']} ({row['method']})", "description": "",
                    "doctor_name": None, "clinic_name": row["clinic_name"],
                    "family_member_name": row["family_member_name"], "ref_id": row["id"], "status": None,
                })

    # ---- Vaccinations ----
    if not f["type"] or f["type"] == "Vaccination":
        if not f["doctor_id"] and not f["clinic_id"]:  # vaccinations have no doctor/clinic linkage
            params = [patient_id]
            sql = """SELECT v.id, v.date_given, v.vaccine_name, v.dose_number, v.given_by,
                             v.family_member_id, fm.full_name AS family_member_name
                      FROM vaccinations v
                      LEFT JOIN family_members fm ON fm.id = v.family_member_id
                      WHERE v.patient_id=%s"""
            sql += _date_clause("v.date_given", f, params)
            if f["family_member_id"]:
                sql += " AND v.family_member_id=%s"; params.append(f["family_member_id"])
            for row in query(sql, params):
                events.append({
                    "event_type": "Vaccination", "event_date": str(row["date_given"]), "event_time": None,
                    "title": f"Vaccination: {row['vaccine_name']} (Dose {row['dose_number']})",
                    "description": f"Given by {row['given_by']}" if row["given_by"] else "",
                    "doctor_name": None, "clinic_name": None,
                    "family_member_name": row["family_member_name"], "ref_id": row["id"], "status": None,
                })

    # ---- Follow-ups ----
    if not f["type"] or f["type"] == "Follow-up":
        params = [patient_id]
        sql = """SELECT fu.id, fu.followup_date, fu.reason, fu.status, fu.doctor_id,
                         d.full_name AS doctor_name, a.clinic_id, c.name AS clinic_name,
                         a.family_member_id, fm.full_name AS family_member_name
                  FROM followups fu
                  JOIN doctors d ON d.id = fu.doctor_id
                  JOIN appointments a ON a.id = fu.appointment_id
                  JOIN clinics c ON c.id = a.clinic_id
                  LEFT JOIN family_members fm ON fm.id = a.family_member_id
                  WHERE fu.patient_id=%s"""
        sql += _date_clause("fu.followup_date", f, params)
        if f["doctor_id"]:
            sql += " AND fu.doctor_id=%s"; params.append(f["doctor_id"])
        if f["clinic_id"]:
            sql += " AND a.clinic_id=%s"; params.append(f["clinic_id"])
        if f["family_member_id"]:
            sql += " AND a.family_member_id=%s"; params.append(f["family_member_id"])
        for row in query(sql, params):
            events.append({
                "event_type": "Follow-up", "event_date": str(row["followup_date"]), "event_time": None,
                "title": "Follow-up appointment", "description": row["reason"] or "",
                "doctor_name": row["doctor_name"], "clinic_name": row["clinic_name"],
                "family_member_name": row["family_member_name"], "ref_id": row["id"], "status": row["status"],
            })

    events.sort(key=lambda e: (e["event_date"], e["event_time"] or ""), reverse=True)
    return jsonify(events)
