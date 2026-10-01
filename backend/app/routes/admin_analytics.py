import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit, add_notification
from app.utils.permissions import require_permission

bp = Blueprint("admin_analytics", __name__, url_prefix="/api/admin")

GRANULARITIES = {
    "daily": "%Y-%m-%d",
    "weekly": "%x-W%v",
    "monthly": "%Y-%m",
}


# ==================== Appointment / Patient Growth / Revenue Analytics ====================
@bp.get("/analytics/appointments")
@require_auth(["admin"])
def appointment_analytics():
    granularity = request.args.get("granularity", "daily")
    if granularity not in GRANULARITIES:
        return jsonify({"error": f"granularity must be one of {', '.join(GRANULARITIES)}"}), 400
    date_format = GRANULARITIES[granularity]

    params = []
    where = "1=1"
    if request.args.get("start"):
        where += " AND appointment_date >= %s"; params.append(request.args["start"])
    if request.args.get("end"):
        where += " AND appointment_date <= %s"; params.append(request.args["end"])

    rows = query(
        f"""SELECT DATE_FORMAT(appointment_date, %s) AS bucket, status, COUNT(*) AS total
            FROM appointments WHERE {where}
            GROUP BY bucket, status ORDER BY bucket""",
        [date_format] + params,
    )
    return jsonify(rows)


@bp.get("/analytics/patient-growth")
@require_auth(["admin"])
def patient_growth():
    rows = query(
        """SELECT DATE_FORMAT(u.created_at, '%Y-%m') AS month, COUNT(*) AS new_patients
           FROM patients p JOIN users u ON u.id = p.user_id
           GROUP BY month ORDER BY month"""
    )
    return jsonify(rows)


@bp.get("/analytics/revenue")
@require_auth(["admin"])
def revenue_analytics():
    granularity = request.args.get("granularity", "daily")
    if granularity not in GRANULARITIES:
        return jsonify({"error": f"granularity must be one of {', '.join(GRANULARITIES)}"}), 400
    date_format = GRANULARITIES[granularity]

    params = [date_format]
    where = "pay.status='Paid'"
    if request.args.get("start"):
        where += " AND pay.transaction_date >= %s"; params.append(request.args["start"])
    if request.args.get("end"):
        where += " AND pay.transaction_date <= %s"; params.append(request.args["end"])

    by_period = query(
        f"""SELECT DATE_FORMAT(pay.transaction_date, %s) AS bucket, SUM(pay.amount) AS total
            FROM payments pay WHERE {where} GROUP BY bucket ORDER BY bucket""",
        params,
    )
    by_org = query(
        f"""SELECT c.name AS clinic_name, c.org_type, SUM(pay.amount) AS total
            FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN clinics c ON c.id = i.clinic_id
            WHERE {where} GROUP BY c.id, c.name, c.org_type ORDER BY total DESC""",
        params[1:],
    )
    return jsonify({"by_period": by_period, "by_organization": by_org})


@bp.get("/analytics/organizations")
@require_auth(["admin"])
def organization_analytics():
    rows = query(
        """SELECT c.id, c.name, c.org_type,
                  COUNT(DISTINCT a.id) AS total_appointments,
                  COUNT(DISTINCT a.patient_id) AS patient_volume,
                  SUM(CASE WHEN a.status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
                  SUM(CASE WHEN a.status='CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
                  SUM(CASE WHEN a.status='NO_SHOW' THEN 1 ELSE 0 END) AS no_shows
           FROM clinics c
           LEFT JOIN appointments a ON a.clinic_id = c.id
           WHERE c.approval_status='APPROVED'
           GROUP BY c.id, c.name, c.org_type
           ORDER BY total_appointments DESC"""
    )
    return jsonify(rows)


# ==================== Doctor Performance Dashboard ====================
@bp.get("/analytics/doctors")
@require_auth(["admin"])
def doctor_performance_list():
    """Summary row per doctor for the performance dashboard's overview table."""
    rows = query(
        """SELECT d.id, d.doctor_code, d.full_name, d.specialization, d.verification_status, d.is_active,
                  COUNT(a.id) AS total_appointments,
                  SUM(CASE WHEN a.status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
                  SUM(CASE WHEN a.status='CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
                  SUM(CASE WHEN a.status='NO_SHOW' THEN 1 ELSE 0 END) AS no_shows,
                  COUNT(DISTINCT cd.clinic_id) AS active_organizations,
                  AVG(f.rating) AS avg_rating
           FROM doctors d
           LEFT JOIN appointments a ON a.doctor_id = d.id
           LEFT JOIN clinic_doctors cd ON cd.doctor_id = d.id AND cd.status='active'
           LEFT JOIN feedback f ON f.doctor_id = d.id
           GROUP BY d.id ORDER BY total_appointments DESC"""
    )
    for r in rows:
        total = r["total_appointments"] or 0
        r["cancellation_rate"] = round((r["cancelled"] or 0) / total * 100, 1) if total else 0.0
        r["no_show_rate"] = round((r["no_shows"] or 0) / total * 100, 1) if total else 0.0
        r["avg_rating"] = round(float(r["avg_rating"]), 2) if r["avg_rating"] is not None else None
    return jsonify(rows)


@bp.get("/analytics/doctors/<int:doctor_id>")
@require_auth(["admin"])
def doctor_performance_detail(doctor_id):
    """Deeper view for a single doctor, including a genuine average
    consultation duration computed from real check-in/consultation timestamps
    (not estimated) — only counting visits that actually went through the
    OPD queue's status flow."""
    doctor = query("SELECT * FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404

    stats = query(
        """SELECT COUNT(*) AS total_appointments,
                  SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
                  SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
                  SUM(CASE WHEN status='NO_SHOW' THEN 1 ELSE 0 END) AS no_shows
           FROM appointments WHERE doctor_id=%s""",
        (doctor_id,), fetchone=True,
    )
    total = stats["total_appointments"] or 0
    stats["cancellation_rate"] = round((stats["cancelled"] or 0) / total * 100, 1) if total else 0.0
    stats["no_show_rate"] = round((stats["no_shows"] or 0) / total * 100, 1) if total else 0.0

    duration_row = query(
        """SELECT AVG(TIMESTAMPDIFF(MINUTE, consultation_started_at, consultation_completed_at)) AS avg_minutes,
                  COUNT(*) AS sample_size
           FROM opd_queue
           WHERE doctor_id=%s AND consultation_started_at IS NOT NULL AND consultation_completed_at IS NOT NULL""",
        (doctor_id,), fetchone=True,
    )
    avg_duration = round(float(duration_row["avg_minutes"]), 1) if duration_row["avg_minutes"] is not None else None

    rating_row = query(
        "SELECT AVG(rating) AS avg_rating, COUNT(*) AS total_reviews FROM feedback WHERE doctor_id=%s",
        (doctor_id,), fetchone=True,
    )
    organizations = query(
        """SELECT c.id, c.name, c.org_type, cd.status FROM clinic_doctors cd
           JOIN clinics c ON c.id = cd.clinic_id WHERE cd.doctor_id=%s""",
        (doctor_id,),
    )

    return jsonify({
        "doctor": {
            "id": doctor["id"], "doctor_code": doctor["doctor_code"], "full_name": doctor["full_name"],
            "specialization": doctor["specialization"], "verification_status": doctor["verification_status"],
            "is_active": bool(doctor["is_active"]),
        },
        "stats": stats,
        "avg_consultation_minutes": avg_duration,
        "consultation_duration_sample_size": duration_row["sample_size"],
        "avg_rating": round(float(rating_row["avg_rating"]), 2) if rating_row["avg_rating"] is not None else None,
        "total_reviews": rating_row["total_reviews"],
        "organizations": organizations,
    })


# ==================== Document Expiry Alerts ====================
EXPIRY_WARNING_DAYS = 30


@bp.get("/document-expiry")
@require_auth(["admin"])
def document_expiry():
    rows = query(
        """SELECT dd.id, dd.doc_type, dd.issue_date, dd.expiry_date, dd.original_name,
                  d.id AS doctor_id, d.doctor_code, d.full_name, d.verification_status
           FROM doctor_documents dd
           JOIN doctors d ON d.id = dd.doctor_id
           WHERE dd.expiry_date IS NOT NULL
           ORDER BY dd.expiry_date ASC"""
    )
    today = datetime.date.today()
    buckets = {"expired": [], "expiring_soon": [], "expiring_later": [], "valid": []}
    for r in rows:
        expiry = r["expiry_date"]
        if isinstance(expiry, str):
            expiry = datetime.datetime.strptime(expiry, "%Y-%m-%d").date()
        days_left = (expiry - today).days
        r["days_until_expiry"] = days_left
        if days_left < 0:
            buckets["expired"].append(r)
        elif days_left <= EXPIRY_WARNING_DAYS:
            buckets["expiring_soon"].append(r)
        elif days_left <= 90:
            buckets["expiring_later"].append(r)
        else:
            buckets["valid"].append(r)
    return jsonify({
        "counts": {k: len(v) for k, v in buckets.items()},
        **buckets,
    })


@bp.put("/documents/<int:doc_id>/expiry")
@require_auth(["admin"])
def set_document_expiry(doc_id):
    doc = query("SELECT * FROM doctor_documents WHERE id=%s", (doc_id,), fetchone=True)
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
    add_audit(g.user_id, "admin", "DOCUMENT_EXPIRY_SET", f"Document #{doc_id}")
    return jsonify({"message": "Updated"})



# ==================== Audit Log Viewer (paginated, filterable, read-only) ====================
@bp.get("/audit-logs")
@require_auth(["admin"])
@require_permission("admin.view_audit_logs")
def admin_audit_logs():
    page = max(request.args.get("page", 1, type=int), 1)
    page_size = min(request.args.get("page_size", 25, type=int), 100)
    offset = (page - 1) * page_size

    where, params = ["1=1"], []
    if request.args.get("role"):
        where.append("role=%s"); params.append(request.args["role"])
    if request.args.get("module"):
        where.append("module=%s"); params.append(request.args["module"])
    if request.args.get("action"):
        where.append("action LIKE %s"); params.append(f"%{request.args['action']}%")
    if request.args.get("clinic_id"):
        where.append("clinic_id=%s"); params.append(request.args["clinic_id"])
    if request.args.get("date_from"):
        where.append("created_at >= %s"); params.append(request.args["date_from"])
    if request.args.get("date_to"):
        where.append("created_at <= %s"); params.append(request.args["date_to"])
    where_clause = " AND ".join(where)

    total = query(f"SELECT COUNT(*) AS c FROM audit_logs WHERE {where_clause}", params, fetchone=True)["c"]
    rows = query(
        f"""SELECT al.*, u.email, c.name AS clinic_name FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id
            LEFT JOIN clinics c ON c.id = al.clinic_id
            WHERE {where_clause} ORDER BY al.created_at DESC LIMIT %s OFFSET %s""",
        params + [page_size, offset],
    )
    return jsonify({"total": total, "page": page, "page_size": page_size, "logs": rows})


@bp.get("/audit-logs/modules")
@require_auth(["admin"])
def audit_log_modules():
    """Distinct modules seen so far, to populate the filter dropdown."""
    rows = query("SELECT DISTINCT module FROM audit_logs WHERE module IS NOT NULL ORDER BY module")
    return jsonify([r["module"] for r in rows])
