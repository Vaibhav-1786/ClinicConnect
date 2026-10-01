import os

from flask import Blueprint, request, jsonify, g, current_app
from werkzeug.utils import secure_filename

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_notification, add_audit
from config import Config

bp = Blueprint("clinical", __name__, url_prefix="/api")


# ---------------- SOAP notes ----------------
@bp.post("/soap-notes")
@require_auth(["doctor"])
def add_soap_note():
    data = request.get_json(force=True) or {}
    if not data.get("appointment_id"):
        return jsonify({"error": "appointment_id required"}), 400
    new_id = execute(
        "INSERT INTO soap_notes (appointment_id, subjective, objective, assessment, plan) VALUES (%s,%s,%s,%s,%s)",
        (data["appointment_id"], data.get("subjective"), data.get("objective"),
         data.get("assessment"), data.get("plan")),
    )
    return jsonify({"id": new_id}), 201


@bp.get("/soap-notes/<int:appointment_id>")
@require_auth(["doctor", "receptionist"])
def get_soap_notes(appointment_id):
    return jsonify(query("SELECT * FROM soap_notes WHERE appointment_id=%s ORDER BY created_at DESC", (appointment_id,)))


# ---------------- Follow-ups ----------------
@bp.post("/followups")
@require_auth(["doctor"])
def create_followup():
    data = request.get_json(force=True) or {}
    required = ["appointment_id", "patient_id", "followup_date"]
    if any(f not in data for f in required):
        return jsonify({"error": "appointment_id, patient_id, followup_date required"}), 400
    new_id = execute(
        """INSERT INTO followups (appointment_id, patient_id, doctor_id, followup_date, reason, notes)
           VALUES (%s,%s,%s,%s,%s,%s)""",
        (data["appointment_id"], data["patient_id"], g.profile_id, data["followup_date"],
         data.get("reason", ""), data.get("notes", "")),
    )
    patient_user = query(
        "SELECT u.id FROM patients p JOIN users u ON u.id=p.user_id WHERE p.id=%s", (data["patient_id"],), fetchone=True
    )
    add_notification(patient_user["id"], "followup_scheduled", "Follow-up Scheduled",
                      f"A follow-up has been scheduled for {data['followup_date']}.")
    return jsonify({"id": new_id}), 201


@bp.get("/followups/patient")
@require_auth(["patient"])
def patient_followups():
    return jsonify(query(
        """SELECT f.*, d.full_name AS doctor_name FROM followups f JOIN doctors d ON d.id=f.doctor_id
           WHERE f.patient_id=%s ORDER BY f.followup_date""",
        (g.profile_id,),
    ))


@bp.get("/followups/doctor")
@require_auth(["doctor"])
def doctor_followups():
    return jsonify(query(
        """SELECT f.*, p.full_name AS patient_name FROM followups f JOIN patients p ON p.id=f.patient_id
           WHERE f.doctor_id=%s ORDER BY f.followup_date""",
        (g.profile_id,),
    ))


# ---------------- Vaccinations ----------------
@bp.post("/vaccinations")
@require_auth(["doctor", "receptionist"])
def add_vaccination():
    data = request.get_json(force=True) or {}
    if not data.get("patient_id") or not data.get("vaccine_name"):
        return jsonify({"error": "patient_id and vaccine_name required"}), 400
    new_id = execute(
        """INSERT INTO vaccinations (patient_id, vaccine_name, dose_number, date_given, next_due_date, given_by, notes)
           VALUES (%s,%s,%s,%s,%s,%s,%s)""",
        (data["patient_id"], data["vaccine_name"], data.get("dose_number"), data.get("date_given"),
         data.get("next_due_date"), data.get("given_by"), data.get("notes")),
    )
    return jsonify({"id": new_id}), 201


@bp.get("/vaccinations/<int:patient_id>")
@require_auth(["doctor", "receptionist", "patient"])
def list_vaccinations(patient_id):
    if g.role == "patient" and g.profile_id != patient_id:
        return jsonify({"error": "Forbidden"}), 403
    return jsonify(query("SELECT * FROM vaccinations WHERE patient_id=%s ORDER BY date_given DESC", (patient_id,)))


# ---------------- Documents ----------------
ALLOWED_EXT = {"pdf", "png", "jpg", "jpeg"}


@bp.post("/documents")
@require_auth(["patient", "doctor", "receptionist"])
def upload_document():
    if "file" not in request.files:
        return jsonify({"error": "file is required"}), 400
    file = request.files["file"]
    patient_id = request.form.get("patient_id")
    doc_type = request.form.get("doc_type", "other")
    replace_document_id = request.form.get("replace_document_id", type=int)
    if not patient_id:
        return jsonify({"error": "patient_id required"}), 400
    if g.role == "patient" and int(patient_id) != g.profile_id:
        return jsonify({"error": "Forbidden"}), 403
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXT:
        return jsonify({"error": "Unsupported file type"}), 400

    upload_dir = os.path.join(current_app.root_path, "..", Config.UPLOAD_FOLDER, "documents")
    os.makedirs(upload_dir, exist_ok=True)
    safe_name = secure_filename(f"{patient_id}_{doc_type}_{file.filename}")
    full_path = os.path.join(upload_dir, safe_name)
    file.save(full_path)

    # Digital Document Center version history (spec section 15): a new
    # upload naming an existing document as `replace_document_id` becomes
    # the next version in that document's lineage instead of an unrelated
    # new document. The previous version is kept (not deleted) and just
    # marked no-longer-latest, so "Version History" can show the full trail.
    parent_id = None
    version_number = 1
    if replace_document_id:
        prev = query("SELECT * FROM documents WHERE id=%s AND patient_id=%s", (replace_document_id, patient_id), fetchone=True)
        if not prev:
            return jsonify({"error": "Document to replace not found for this patient"}), 404
        parent_id = prev["parent_document_id"] or prev["id"]
        version_number = prev["version_number"] + 1
        execute("UPDATE documents SET is_latest=0 WHERE id=%s", (prev["id"],))
        doc_type = prev["doc_type"]  # keep the same document type across versions

    new_id = execute(
        """INSERT INTO documents (patient_id, uploaded_by, doc_type, file_path, original_name, version_number, is_latest)
           VALUES (%s,%s,%s,%s,%s,%s,1)""",
        (patient_id, g.user_id, doc_type, f"documents/{safe_name}", file.filename, version_number),
    )
    if parent_id is None:
        parent_id = new_id
    execute("UPDATE documents SET parent_document_id=%s WHERE id=%s", (parent_id, new_id))
    add_audit(g.user_id, g.role, "DOCUMENT_UPLOADED", f"Doc #{new_id} v{version_number} ({doc_type}) for patient #{patient_id}")
    return jsonify({"id": new_id, "version_number": version_number}), 201


@bp.get("/documents/<int:patient_id>")
@require_auth(["doctor", "receptionist", "patient"])
def list_documents(patient_id):
    if g.role == "patient" and g.profile_id != patient_id:
        return jsonify({"error": "Forbidden"}), 403
    if g.role == "doctor":
        # doctor may only access documents of patients they have an appointment with
        link = query(
            "SELECT id FROM appointments WHERE doctor_id=%s AND patient_id=%s LIMIT 1",
            (g.profile_id, patient_id), fetchone=True,
        )
        if not link:
            return jsonify({"error": "Forbidden: no authorized appointment with this patient"}), 403
    return jsonify(query(
        """SELECT id, doc_type, original_name, created_at, version_number, is_latest, status, parent_document_id
           FROM documents WHERE patient_id=%s AND is_latest=1 ORDER BY created_at DESC""",
        (patient_id,),
    ))


@bp.get("/documents/<int:document_id>/versions")
@require_auth(["doctor", "receptionist", "patient"])
def document_versions(document_id):
    """Full version history for the lineage this document belongs to."""
    doc = query("SELECT * FROM documents WHERE id=%s", (document_id,), fetchone=True)
    if not doc:
        return jsonify({"error": "Document not found"}), 404
    if g.role == "patient" and g.profile_id != doc["patient_id"]:
        return jsonify({"error": "Forbidden"}), 403
    lineage_root = doc["parent_document_id"] or doc["id"]
    versions = query(
        """SELECT d.id, d.original_name, d.version_number, d.is_latest, d.status, d.created_at, u.email AS uploaded_by_email
           FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
           WHERE d.parent_document_id=%s OR d.id=%s
           ORDER BY d.version_number DESC""",
        (lineage_root, lineage_root),
    )
    return jsonify(versions)


# ---------------- Lab orders / reports ----------------
@bp.get("/lab-tests")
@require_auth()
def list_lab_tests():
    return jsonify(query("SELECT * FROM lab_tests WHERE status='active' ORDER BY test_name"))


@bp.post("/lab-orders")
@require_auth(["doctor"])
def create_lab_order():
    data = request.get_json(force=True) or {}
    required = ["appointment_id", "patient_id", "lab_test_id"]
    if any(f not in data for f in required):
        return jsonify({"error": "appointment_id, patient_id, lab_test_id required"}), 400
    new_id = execute(
        """INSERT INTO lab_orders (appointment_id, doctor_id, patient_id, lab_test_id, instructions)
           VALUES (%s,%s,%s,%s,%s)""",
        (data["appointment_id"], g.profile_id, data["patient_id"], data["lab_test_id"], data.get("instructions", "")),
    )
    return jsonify({"id": new_id}), 201


@bp.get("/lab-orders/patient")
@require_auth(["patient"])
def patient_lab_orders():
    return jsonify(query(
        """SELECT lo.*, lt.test_name, lt.price FROM lab_orders lo JOIN lab_tests lt ON lt.id=lo.lab_test_id
           WHERE lo.patient_id=%s ORDER BY lo.created_at DESC""",
        (g.profile_id,),
    ))


@bp.get("/lab-orders/pending")
@require_auth(["receptionist"])
def pending_lab_orders():
    return jsonify(query(
        """SELECT lo.*, lt.test_name, p.full_name AS patient_name FROM lab_orders lo
           JOIN lab_tests lt ON lt.id=lo.lab_test_id JOIN patients p ON p.id=lo.patient_id
           WHERE lo.status != 'completed' ORDER BY lo.created_at"""
    ))


@bp.post("/lab-orders/<int:order_id>/status")
@require_auth(["receptionist"])
def update_lab_order_status(order_id):
    data = request.get_json(force=True) or {}
    execute("UPDATE lab_orders SET status=%s WHERE id=%s", (data.get("status"), order_id))
    return jsonify({"message": "Updated"})


@bp.post("/lab-orders/<int:order_id>/report")
@require_auth(["receptionist"])
def upload_lab_report(order_id):
    data = request.get_json(force=True) or {}
    new_id = execute(
        "INSERT INTO lab_reports (lab_order_id, result_value) VALUES (%s,%s)",
        (order_id, data.get("result_value")),
    )
    execute("UPDATE lab_orders SET status='completed' WHERE id=%s", (order_id,))
    return jsonify({"id": new_id}), 201


@bp.get("/lab-reports/<int:order_id>")
@require_auth(["patient", "doctor", "receptionist"])
def get_lab_report(order_id):
    return jsonify(query("SELECT * FROM lab_reports WHERE lab_order_id=%s", (order_id,)))


# ---------------- Feedback ----------------
@bp.post("/feedback")
@require_auth(["patient"])
def submit_feedback():
    data = request.get_json(force=True) or {}
    required = ["appointment_id", "rating"]
    if any(f not in data for f in required):
        return jsonify({"error": "appointment_id and rating required"}), 400
    appt = query("SELECT * FROM appointments WHERE id=%s AND patient_id=%s", (data["appointment_id"], g.profile_id), fetchone=True)
    if not appt:
        return jsonify({"error": "Appointment not found"}), 404
    if appt["status"] != "COMPLETED":
        return jsonify({"error": "Feedback allowed only after a completed appointment"}), 409
    existing = query("SELECT id FROM feedback WHERE appointment_id=%s", (data["appointment_id"],), fetchone=True)
    if existing:
        return jsonify({"error": "Feedback already submitted for this appointment"}), 409
    new_id = execute(
        """INSERT INTO feedback (appointment_id, patient_id, doctor_id, clinic_id, rating, comment)
           VALUES (%s,%s,%s,%s,%s,%s)""",
        (appt["id"], g.profile_id, appt["doctor_id"], appt["clinic_id"], data["rating"], data.get("comment", "")),
    )
    return jsonify({"id": new_id}), 201


# ---------------- OPD queue / walk-in tokens ----------------
@bp.post("/opd/check-in")
@require_auth(["receptionist"])
def opd_check_in():
    data = request.get_json(force=True) or {}

    if data.get("appointment_id"):
        appt = query("SELECT * FROM appointments WHERE id=%s", (data["appointment_id"],), fetchone=True)
        if not appt:
            return jsonify({"error": "Appointment not found"}), 404
        if appt["clinic_id"] != g.clinic_id:
            return jsonify({"error": "Appointment does not belong to your clinic"}), 403
        clinic_id, doctor_id, patient_id = appt["clinic_id"], appt["doctor_id"], appt["patient_id"]
        visit_type, walk_in_name, walk_in_phone = "APPOINTMENT", None, None
        appointment_id = appt["id"]
    else:
        # Pure walk-in: no pre-booked appointment. Needs at minimum a doctor
        # and either an existing patient or a name to identify them at the
        # counter (spec: "Patient name, Doctor, Organization, Walk-in type").
        if not data.get("doctor_id"):
            return jsonify({"error": "doctor_id is required for a walk-in"}), 400
        if not data.get("patient_id") and not (data.get("walk_in_name") or "").strip():
            return jsonify({"error": "Provide a registered patient_id or a walk_in_name"}), 400
        link = query("SELECT id FROM clinic_doctors WHERE clinic_id=%s AND doctor_id=%s", (g.clinic_id, data["doctor_id"]), fetchone=True)
        if not link:
            return jsonify({"error": "Doctor is not associated with your clinic"}), 400
        clinic_id, doctor_id = g.clinic_id, data["doctor_id"]
        patient_id = data.get("patient_id")
        walk_in_name = None if patient_id else data.get("walk_in_name", "").strip()
        walk_in_phone = data.get("walk_in_phone")
        visit_type, appointment_id = "WALK-IN", None

    last_token = query(
        "SELECT COALESCE(MAX(token_number),0) AS mx FROM opd_queue WHERE clinic_id=%s AND DATE(check_in_time)=CURDATE()",
        (clinic_id,), fetchone=True,
    )["mx"]
    new_id = execute(
        """INSERT INTO opd_queue (appointment_id, patient_id, walk_in_name, walk_in_phone,
           clinic_id, doctor_id, visit_type, token_number)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (appointment_id, patient_id, walk_in_name, walk_in_phone, clinic_id, doctor_id, visit_type, last_token + 1),
    )
    if appointment_id:
        execute("UPDATE appointments SET status='CHECKED_IN' WHERE id=%s", (appointment_id,))
    add_audit(g.user_id, "receptionist", "OPD_CHECK_IN", f"Token #{last_token + 1} ({visit_type})")
    return jsonify({"id": new_id, "token_number": last_token + 1}), 201


@bp.get("/opd/queue")
@require_auth(["receptionist", "doctor"])
def opd_queue_list():
    clinic_id = request.args.get("clinic_id") or (g.clinic_id if g.role == "receptionist" else None)
    sql = """SELECT q.*,
                    COALESCE(p.full_name, q.walk_in_name) AS patient_name,
                    d.full_name AS doctor_name
              FROM opd_queue q
              LEFT JOIN patients p ON p.id = q.patient_id
              JOIN doctors d ON d.id = q.doctor_id
              WHERE DATE(q.check_in_time)=CURDATE()"""
    params = []
    if clinic_id:
        sql += " AND q.clinic_id=%s"; params.append(clinic_id)
    if g.role == "doctor":
        sql += " AND q.doctor_id=%s"; params.append(g.profile_id)
    sql += " ORDER BY q.token_number"
    return jsonify(query(sql, params))


@bp.get("/receptionist/queue/summary")
@require_auth(["receptionist"])
def receptionist_queue_summary():
    """Convenience view for the front-desk screen: current token being served,
    the next one waiting, and the rest of the line — for the receptionist's
    own clinic, refreshed for 'today' only."""
    doctor_id = request.args.get("doctor_id")
    sql = """SELECT q.*, COALESCE(p.full_name, q.walk_in_name) AS patient_name, d.full_name AS doctor_name
              FROM opd_queue q
              LEFT JOIN patients p ON p.id = q.patient_id
              JOIN doctors d ON d.id = q.doctor_id
              WHERE q.clinic_id=%s AND DATE(q.check_in_time)=CURDATE()"""
    params = [g.clinic_id]
    if doctor_id:
        sql += " AND q.doctor_id=%s"; params.append(doctor_id)
    sql += " ORDER BY q.token_number"
    rows = query(sql, params)

    current = next((r for r in rows if r["status"] in ("Called", "In Consultation")), None)
    waiting = [r for r in rows if r["status"] == "Waiting"]
    next_up = waiting[0] if waiting else None
    return jsonify({"current": current, "next": next_up, "waiting": waiting, "all": rows})


@bp.post("/opd/queue/<int:queue_id>/status")
@require_auth(["receptionist", "doctor"])
def opd_update_status(queue_id):
    data = request.get_json(force=True) or {}
    new_status = data.get("status")
    valid = {"Waiting", "Called", "In Consultation", "Completed", "Cancelled", "No Show"}
    if new_status not in valid:
        return jsonify({"error": f"status must be one of {', '.join(sorted(valid))}"}), 400

    entry = query("SELECT * FROM opd_queue WHERE id=%s", (queue_id,), fetchone=True)
    if not entry:
        return jsonify({"error": "Queue entry not found"}), 404
    if g.role == "receptionist" and entry["clinic_id"] != g.clinic_id:
        return jsonify({"error": "Forbidden"}), 403
    if g.role == "doctor" and entry["doctor_id"] != g.profile_id:
        return jsonify({"error": "Forbidden"}), 403

    execute("UPDATE opd_queue SET status=%s WHERE id=%s", (new_status, queue_id))
    if new_status == "In Consultation":
        execute("UPDATE opd_queue SET consultation_started_at=NOW() WHERE id=%s", (queue_id,))
    elif new_status == "Completed":
        execute("UPDATE opd_queue SET consultation_completed_at=NOW() WHERE id=%s", (queue_id,))
    if entry["appointment_id"] and new_status == "In Consultation":
        execute("UPDATE appointments SET status='IN_CONSULTATION' WHERE id=%s", (entry["appointment_id"],))
    elif entry["appointment_id"] and new_status == "Completed":
        execute("UPDATE appointments SET status='COMPLETED' WHERE id=%s", (entry["appointment_id"],))
    add_audit(g.user_id, g.role, "OPD_STATUS_CHANGE", f"Queue #{queue_id} -> {new_status}")
    return jsonify({"message": "Updated"})


@bp.get("/patient/queue/status")
@require_auth(["patient"])
def patient_queue_status():
    rows = query(
        """SELECT q.*, d.full_name AS doctor_name, c.name AS clinic_name
           FROM opd_queue q
           JOIN doctors d ON d.id = q.doctor_id
           JOIN clinics c ON c.id = q.clinic_id
           WHERE q.patient_id=%s AND DATE(q.check_in_time)=CURDATE()
           ORDER BY q.check_in_time DESC""",
        (g.profile_id,),
    )
    active = [r for r in rows if r["status"] in ("Waiting", "Called", "Skipped")]
    if not active:
        return jsonify(rows)

    my_entry = active[0]
    ahead = query(
        """SELECT COUNT(*) AS c FROM opd_queue
           WHERE clinic_id=%s AND doctor_id=%s AND DATE(check_in_time)=CURDATE()
           AND status IN ('Waiting','Called') AND token_number < %s""",
        (my_entry["clinic_id"], my_entry["doctor_id"], my_entry["token_number"]), fetchone=True,
    )["c"]
    # ~10 minutes per patient ahead is a rough, transparent estimate — this
    # is shown to patients as an approximation, not a guarantee.
    my_entry["queue_position"] = ahead + 1
    my_entry["estimated_wait_minutes"] = ahead * 10
    for r in rows:
        if r["id"] == my_entry["id"]:
            r["queue_position"] = my_entry["queue_position"]
            r["estimated_wait_minutes"] = my_entry["estimated_wait_minutes"]
    return jsonify(rows)
