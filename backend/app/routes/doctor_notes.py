import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit

bp = Blueprint("doctor_notes", __name__, url_prefix="/api/doctor")

VALID_SOURCES = {"typed", "voice", "template"}


# ==================== Note Templates ====================
def _owned_template(template_id):
    return query(
        "SELECT * FROM doctor_note_templates WHERE id=%s AND doctor_id=%s",
        (template_id, g.profile_id), fetchone=True,
    )


@bp.get("/note-templates")
@require_auth(["doctor"])
def list_templates():
    return jsonify(query(
        "SELECT * FROM doctor_note_templates WHERE doctor_id=%s ORDER BY updated_at DESC",
        (g.profile_id,),
    ))


@bp.post("/note-templates")
@require_auth(["doctor"])
def create_template():
    data = request.get_json(force=True) or {}
    if not (data.get("title") or "").strip():
        return jsonify({"error": "Template title is required"}), 400
    template_id = execute(
        """INSERT INTO doctor_note_templates
           (doctor_id, clinic_id, title, chief_complaint, examination, assessment, plan, follow_up)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (g.profile_id, g.clinic_id, data["title"].strip(), data.get("chief_complaint", ""),
         data.get("examination", ""), data.get("assessment", ""), data.get("plan", ""), data.get("follow_up", "")),
    )
    add_audit(g.user_id, "doctor", "NOTE_TEMPLATE_CREATED", f"#{template_id}")
    return jsonify(_owned_template(template_id)), 201


@bp.put("/note-templates/<int:template_id>")
@require_auth(["doctor"])
def update_template(template_id):
    if not _owned_template(template_id):
        return jsonify({"error": "Template not found"}), 404
    data = request.get_json(force=True) or {}
    fields, params = [], []
    for f in ["title", "chief_complaint", "examination", "assessment", "plan", "follow_up"]:
        if f in data:
            fields.append(f"{f}=%s")
            params.append(data[f].strip() if f == "title" else data[f])
    if not fields:
        return jsonify({"error": "No fields to update"}), 400
    params.extend([template_id, g.profile_id])
    execute(f"UPDATE doctor_note_templates SET {', '.join(fields)} WHERE id=%s AND doctor_id=%s", params)
    return jsonify(_owned_template(template_id))


@bp.delete("/note-templates/<int:template_id>")
@require_auth(["doctor"])
def delete_template(template_id):
    if not _owned_template(template_id):
        return jsonify({"error": "Template not found"}), 404
    execute("DELETE FROM doctor_note_templates WHERE id=%s AND doctor_id=%s", (template_id, g.profile_id))
    add_audit(g.user_id, "doctor", "NOTE_TEMPLATE_DELETED", f"#{template_id}")
    return jsonify({"message": "Template deleted"})


@bp.post("/note-templates/<int:template_id>/duplicate")
@require_auth(["doctor"])
def duplicate_template(template_id):
    src = _owned_template(template_id)
    if not src:
        return jsonify({"error": "Template not found"}), 404
    new_id = execute(
        """INSERT INTO doctor_note_templates
           (doctor_id, clinic_id, title, chief_complaint, examination, assessment, plan, follow_up)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (g.profile_id, src["clinic_id"], f"{src['title']} (copy)", src["chief_complaint"],
         src["examination"], src["assessment"], src["plan"], src["follow_up"]),
    )
    return jsonify(_owned_template(new_id)), 201


# ==================== Consultation Notes (typed / voice / template-derived) ====================
def _doctors_appointment(appointment_id):
    return query(
        "SELECT * FROM appointments WHERE id=%s AND doctor_id=%s", (appointment_id, g.profile_id), fetchone=True,
    )


@bp.get("/consultation-notes/<int:appointment_id>")
@require_auth(["doctor"])
def get_consultation_note(appointment_id):
    if not _doctors_appointment(appointment_id):
        return jsonify({"error": "Appointment not found or not yours"}), 404
    note = query("SELECT * FROM consultation_notes WHERE appointment_id=%s", (appointment_id,), fetchone=True)
    return jsonify(note or {})


@bp.put("/consultation-notes/<int:appointment_id>")
@require_auth(["doctor"])
def save_consultation_note(appointment_id):
    appt = _doctors_appointment(appointment_id)
    if not appt:
        return jsonify({"error": "Appointment not found or not yours"}), 404

    data = request.get_json(force=True) or {}
    source = data.get("source", "typed")
    if source not in VALID_SOURCES:
        return jsonify({"error": f"source must be one of {', '.join(sorted(VALID_SOURCES))}"}), 400

    # A voice transcript or an applied template is only ever a starting point:
    # nothing is auto-saved as a diagnosis or prescription. This endpoint just
    # stores the doctor's own (possibly edited) free text, same as typing.
    template_id = data.get("template_id")
    if template_id and not _owned_template(template_id):
        return jsonify({"error": "Template not found"}), 400

    execute(
        """INSERT INTO consultation_notes
           (appointment_id, doctor_id, patient_id, chief_complaint, examination, assessment, plan, follow_up, source, template_id)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON DUPLICATE KEY UPDATE
             chief_complaint=VALUES(chief_complaint), examination=VALUES(examination),
             assessment=VALUES(assessment), plan=VALUES(plan), follow_up=VALUES(follow_up),
             source=VALUES(source), template_id=VALUES(template_id)""",
        (appointment_id, g.profile_id, appt["patient_id"], data.get("chief_complaint", ""),
         data.get("examination", ""), data.get("assessment", ""), data.get("plan", ""),
         data.get("follow_up", ""), source, template_id),
    )
    add_audit(g.user_id, "doctor", "CONSULTATION_NOTE_SAVED", f"Appt #{appointment_id} ({source})")
    return jsonify(query("SELECT * FROM consultation_notes WHERE appointment_id=%s", (appointment_id,), fetchone=True))


# ==================== Cross-Organization Patient History ====================
@bp.get("/patient-history/<int:patient_id>")
@require_auth(["doctor"])
def patient_history(patient_id):
    # Authorization: a doctor may view a patient's cross-organization history
    # only if they have personally had at least one appointment with that
    # patient — at ANY of their organizations, not just the active one.
    authorized = query(
        "SELECT 1 FROM appointments WHERE doctor_id=%s AND patient_id=%s LIMIT 1",
        (g.profile_id, patient_id), fetchone=True,
    )
    if not authorized:
        return jsonify({"error": "You are not authorized to view this patient's history"}), 403

    patient = query(
        "SELECT id, patient_code, full_name, dob, gender, blood_group, allergies FROM patients WHERE id=%s",
        (patient_id,), fetchone=True,
    )

    appointments = query(
        """SELECT a.id, a.appointment_date, a.appointment_time, a.status, a.reason,
                  d.full_name AS doctor_name, c.name AS clinic_name, c.org_type
           FROM appointments a
           JOIN doctors d ON d.id = a.doctor_id
           JOIN clinics c ON c.id = a.clinic_id
           WHERE a.patient_id=%s ORDER BY a.appointment_date DESC, a.appointment_time DESC""",
        (patient_id,),
    )
    prescriptions = query(
        """SELECT p.id, p.prescription_date, p.diagnosis_text, d.full_name AS doctor_name, c.name AS clinic_name, c.org_type
           FROM prescriptions p
           JOIN doctors d ON d.id = p.doctor_id
           JOIN clinics c ON c.id = p.clinic_id
           WHERE p.patient_id=%s ORDER BY p.prescription_date DESC""",
        (patient_id,),
    )
    for presc in prescriptions:
        items = query(
            "SELECT COALESCE(pi.medicine_name, m.name) AS name, pi.dosage FROM prescription_items pi LEFT JOIN medicines m ON m.id=pi.medicine_id WHERE pi.prescription_id=%s",
            (presc["id"],),
        )
        presc["medicines"] = items

    vitals = query(
        """SELECT v.id, v.recorded_at, v.blood_pressure, v.pulse, v.weight_kg, v.spo2, v.temperature_f,
                  c.name AS clinic_name, c.org_type
           FROM vitals v
           LEFT JOIN appointments a ON a.id = v.appointment_id
           LEFT JOIN clinics c ON c.id = a.clinic_id
           WHERE v.patient_id=%s ORDER BY v.recorded_at DESC""",
        (patient_id,),
    )
    notes = query(
        """SELECT cn.*, d.full_name AS doctor_name, c.name AS clinic_name, c.org_type
           FROM consultation_notes cn
           JOIN doctors d ON d.id = cn.doctor_id
           JOIN appointments a ON a.id = cn.appointment_id
           JOIN clinics c ON c.id = a.clinic_id
           WHERE cn.patient_id=%s ORDER BY cn.updated_at DESC""",
        (patient_id,),
    )
    lab_reports = query(
        """SELECT lr.id, lr.reported_at, lr.result_value, lt.test_name,
                  d.full_name AS doctor_name, c.name AS clinic_name, c.org_type
           FROM lab_reports lr
           JOIN lab_orders lo ON lo.id = lr.lab_order_id
           JOIN lab_tests lt ON lt.id = lo.lab_test_id
           JOIN doctors d ON d.id = lo.doctor_id
           JOIN appointments a ON a.id = lo.appointment_id
           JOIN clinics c ON c.id = a.clinic_id
           WHERE lo.patient_id=%s ORDER BY lr.reported_at DESC""",
        (patient_id,),
    )
    followups = query(
        """SELECT fu.id, fu.followup_date, fu.reason, fu.status, d.full_name AS doctor_name, c.name AS clinic_name, c.org_type
           FROM followups fu
           JOIN doctors d ON d.id = fu.doctor_id
           JOIN appointments a ON a.id = fu.appointment_id
           JOIN clinics c ON c.id = a.clinic_id
           WHERE fu.patient_id=%s ORDER BY fu.followup_date DESC""",
        (patient_id,),
    )

    add_audit(g.user_id, "doctor", "PATIENT_HISTORY_VIEWED", f"Patient #{patient_id}")
    return jsonify({
        "patient": patient, "appointments": appointments, "prescriptions": prescriptions,
        "vitals": vitals, "consultation_notes": notes, "lab_reports": lab_reports, "followups": followups,
    })


# ==================== Document Expiry (doctor self-service) ====================
@bp.get("/documents")
@require_auth(["doctor"])
def list_own_documents():
    return jsonify(query(
        "SELECT * FROM doctor_documents WHERE doctor_id=%s ORDER BY uploaded_at DESC", (g.profile_id,),
    ))


@bp.put("/documents/<int:doc_id>/expiry")
@require_auth(["doctor"])
def doctor_set_document_expiry(doc_id):
    """A doctor may set the issue/expiry date on their OWN verification
    documents — they know their renewal dates. Admin still reviews and
    updates verification status manually; setting a date here never changes
    verification_status by itself (see admin_analytics.document_expiry)."""
    doc = query("SELECT * FROM doctor_documents WHERE id=%s AND doctor_id=%s", (doc_id, g.profile_id), fetchone=True)
    if not doc:
        return jsonify({"error": "Document not found"}), 404
    data = request.get_json(force=True) or {}
    for field in ("issue_date", "expiry_date"):
        if data.get(field):
            try:
                datetime.datetime.strptime(data[field], "%Y-%m-%d")
            except ValueError:
                return jsonify({"error": f"{field} must be in YYYY-MM-DD format"}), 400
    execute(
        "UPDATE doctor_documents SET issue_date=%s, expiry_date=%s WHERE id=%s",
        (data.get("issue_date"), data.get("expiry_date"), doc_id),
    )
    add_audit(g.user_id, "doctor", "DOCUMENT_EXPIRY_SET", f"Document #{doc_id}")
    return jsonify({"message": "Updated"})
