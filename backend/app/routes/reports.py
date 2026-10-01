from flask import Blueprint, request, jsonify, g

from app.utils.db import query
from app.utils.auth import require_auth

bp = Blueprint("reports", __name__, url_prefix="/api/reports")


@bp.get("/receptionist/summary")
@require_auth(["receptionist"])
def receptionist_summary():
    # Scoped to the receptionist's own clinic/hospital only (multi-tenant isolation).
    clinic_id = g.clinic_id
    total_patients = query(
        "SELECT COUNT(DISTINCT patient_id) AS c FROM appointments WHERE clinic_id=%s", (clinic_id,), fetchone=True
    )["c"]
    todays_appts = query(
        "SELECT COUNT(*) AS c FROM appointments WHERE clinic_id=%s AND appointment_date=CURDATE()",
        (clinic_id,), fetchone=True,
    )["c"]
    pending = query(
        "SELECT COUNT(*) AS c FROM appointment_requests WHERE clinic_id=%s AND status IN ('PENDING','UNDER_REVIEW')",
        (clinic_id,), fetchone=True,
    )["c"]
    completed = query(
        "SELECT COUNT(*) AS c FROM appointments WHERE clinic_id=%s AND status='COMPLETED' AND appointment_date=CURDATE()",
        (clinic_id,), fetchone=True,
    )["c"]
    revenue_today = query(
        """SELECT COALESCE(SUM(pay.amount),0) AS r FROM payments pay
           JOIN invoices i ON i.id = pay.invoice_id
           WHERE i.clinic_id=%s AND DATE(pay.transaction_date)=CURDATE() AND pay.status='Paid'""",
        (clinic_id,), fetchone=True,
    )["r"]
    return jsonify({
        "total_patients": total_patients,
        "todays_appointments": todays_appts,
        "pending_requests": pending,
        "completed_today": completed,
        "todays_revenue": float(revenue_today),
    })


@bp.get("/doctor/summary")
@require_auth(["doctor"])
def doctor_summary():
    # Scoped to the currently-selected clinic/hospital only.
    clinic_id = g.clinic_id
    today_patients = query(
        "SELECT COUNT(*) AS c FROM appointments WHERE doctor_id=%s AND clinic_id=%s AND appointment_date=CURDATE()",
        (g.profile_id, clinic_id), fetchone=True,
    )["c"]
    completed = query(
        "SELECT COUNT(*) AS c FROM appointments WHERE doctor_id=%s AND clinic_id=%s AND status='COMPLETED'",
        (g.profile_id, clinic_id), fetchone=True,
    )["c"]
    pending = query(
        "SELECT COUNT(*) AS c FROM appointments WHERE doctor_id=%s AND clinic_id=%s AND status IN ('CONFIRMED','CHECKED_IN')",
        (g.profile_id, clinic_id), fetchone=True,
    )["c"]
    followups = query(
        "SELECT COUNT(*) AS c FROM followups WHERE doctor_id=%s AND status='pending'",
        (g.profile_id,), fetchone=True,
    )["c"]
    waiting_in_queue = query(
        """SELECT COUNT(*) AS c FROM opd_queue q
           WHERE q.doctor_id=%s AND q.clinic_id=%s AND DATE(q.check_in_time)=CURDATE()
           AND q.status IN ('Waiting','Called','Skipped')""",
        (g.profile_id, clinic_id), fetchone=True,
    )["c"]
    completed_today = query(
        "SELECT COUNT(*) AS c FROM appointments WHERE doctor_id=%s AND clinic_id=%s AND status='COMPLETED' AND appointment_date=CURDATE()",
        (g.profile_id, clinic_id), fetchone=True,
    )["c"]
    avg_duration_row = query(
        """SELECT AVG(TIMESTAMPDIFF(MINUTE, q.consultation_started_at, q.consultation_completed_at)) AS avg_minutes
           FROM opd_queue q
           WHERE q.doctor_id=%s AND q.status='Completed'
           AND q.consultation_started_at IS NOT NULL AND q.consultation_completed_at IS NOT NULL
           AND q.check_in_time >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)""",
        (g.profile_id,), fetchone=True,
    )
    avg_minutes = avg_duration_row.get("avg_minutes") if avg_duration_row else None
    return jsonify({
        "todays_patients": today_patients, "completed_consultations": completed,
        "pending_appointments": pending, "pending_followups": followups,
        "waiting_in_queue": waiting_in_queue, "completed_today": completed_today,
        "avg_consultation_minutes": round(float(avg_minutes), 1) if avg_minutes is not None else None,
    })


@bp.get("/revenue")
@require_auth(["receptionist"])
def revenue_report():
    start = request.args.get("start")
    end = request.args.get("end")
    sql = "SELECT DATE(transaction_date) AS day, SUM(amount) AS total FROM payments WHERE status='Paid'"
    params = []
    if start:
        sql += " AND transaction_date >= %s"; params.append(start)
    if end:
        sql += " AND transaction_date <= %s"; params.append(end)
    sql += " GROUP BY DATE(transaction_date) ORDER BY day"
    return jsonify(query(sql, params))


@bp.get("/audit-logs")
@require_auth(["admin"])
def audit_logs():
    # NOTE: previously open to receptionist/doctor roles with zero scoping,
    # which meant any receptionist or doctor account could read every
    # platform-wide audit entry, not just their own clinic's activity. No
    # frontend ever called this (verified), so restricting it to admin closes
    # the gap without breaking anything. See /api/admin/audit-logs for the
    # full-featured, filterable, paginated admin viewer.
    return jsonify(query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200"))
