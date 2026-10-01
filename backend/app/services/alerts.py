"""Smart Alert Center (spec feature #5). Alerts are generated from real,
live conditions (not fabricated) and deduplicated per (alert_type, entity)
so re-running the generator doesn't create endless copies."""
import datetime

from app.utils.db import query, execute


def _upsert_alert(severity, alert_type, title, description, entity_type=None, entity_id=None,
                   action_label=None, action_url=None):
    existing = query(
        """SELECT id FROM admin_alerts WHERE alert_type=%s AND entity_type<=>%s AND entity_id<=>%s
           AND is_resolved=0""",
        (alert_type, entity_type, entity_id), fetchone=True,
    )
    if existing:
        execute(
            "UPDATE admin_alerts SET title=%s, description=%s WHERE id=%s",
            (title, description, existing["id"]),
        )
        return existing["id"]
    return execute(
        """INSERT INTO admin_alerts
           (severity, alert_type, title, description, entity_type, entity_id, action_label, action_url)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (severity, alert_type, title, description, entity_type, entity_id, action_label, action_url),
    )


def generate_alerts():
    """Scan real application state and (re)raise the alerts that still apply.
    Safe to call repeatedly (e.g. on dashboard load or a schedule)."""
    today = datetime.date.today()

    # URGENT: documents expiring within 7 days
    expiring_soon = query(
        """SELECT dd.id, d.id AS doctor_id, d.full_name, dd.expiry_date
           FROM doctor_documents dd JOIN doctors d ON d.id = dd.doctor_id
           WHERE dd.expiry_date IS NOT NULL
                 AND dd.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)"""
    )
    for row in expiring_soon:
        _upsert_alert(
            "URGENT", "DOCUMENT_EXPIRING_7D",
            f"{row['full_name']}'s document expires within 7 days",
            f"Expires {row['expiry_date']}", "DOCTOR", row["doctor_id"],
            "Verify Document", f"/admin/doctors/{row['doctor_id']}",
        )

    # ATTENTION: documents expiring within 30 days (not already urgent)
    expiring_30 = query(
        """SELECT dd.id, d.id AS doctor_id, d.full_name, dd.expiry_date
           FROM doctor_documents dd JOIN doctors d ON d.id = dd.doctor_id
           WHERE dd.expiry_date IS NOT NULL
                 AND dd.expiry_date BETWEEN DATE_ADD(CURDATE(), INTERVAL 8 DAY) AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)"""
    )
    for row in expiring_30:
        _upsert_alert(
            "ATTENTION", "DOCUMENT_EXPIRING_30D",
            f"{row['full_name']}'s document expires within 30 days",
            f"Expires {row['expiry_date']}", "DOCTOR", row["doctor_id"],
            "Review Document", f"/admin/doctors/{row['doctor_id']}",
        )

    # URGENT: applications waiting more than 3 days
    stale_apps = query(
        """SELECT id, full_name, created_at FROM doctor_applications
           WHERE status IN ('PENDING','UNDER_REVIEW') AND created_at <= DATE_SUB(NOW(), INTERVAL 3 DAY)"""
    )
    for row in stale_apps:
        _upsert_alert(
            "URGENT", "APPLICATION_STALE",
            f"Application for {row['full_name']} waiting over 3 days",
            "Pending admin review", "APPLICATION", row["id"],
            "Review Application", f"/admin/applications/{row['id']}",
        )

    # ATTENTION: pending applications in general (fresher than 3 days)
    pending_count = query(
        "SELECT COUNT(*) c FROM doctor_applications WHERE status IN ('PENDING','UNDER_REVIEW')",
        fetchone=True,
    )["c"]
    if pending_count:
        _upsert_alert(
            "ATTENTION", "APPLICATIONS_PENDING_REVIEW",
            f"{pending_count} application(s) waiting for review",
            None, "APPLICATION", None, "Review Applications", "/admin/applications",
        )

    # ATTENTION: incomplete doctor profiles
    incomplete = query(
        "SELECT COUNT(*) c FROM doctors WHERE is_active=1 AND (bio IS NULL OR bio='' OR photo_path IS NULL OR photo_path='')",
        fetchone=True,
    )["c"]
    if incomplete:
        _upsert_alert(
            "ATTENTION", "DOCTOR_PROFILES_INCOMPLETE",
            f"{incomplete} doctor profile(s) incomplete",
            None, "DOCTOR", None, "Review Doctors", "/admin/doctors",
        )

    # ATTENTION: clinics needing verification
    unverified_clinics = query(
        "SELECT id, name FROM clinics WHERE approval_status='PENDING'"
    )
    for row in unverified_clinics:
        _upsert_alert(
            "ATTENTION", "CLINIC_NEEDS_VERIFICATION",
            f"{row['name']} needs verification",
            None, "CLINIC", row["id"], "View Clinic", f"/admin/clinics/{row['id']}",
        )

    # URGENT: overloaded clinics (>=90% utilization today)
    from app.services.capacity import overloaded_clinics
    for c in overloaded_clinics(threshold_pct=90.0):
        _upsert_alert(
            "URGENT", "CLINIC_OVERLOADED",
            f"{c['clinic_name']} is at {c['utilization_pct']}% utilization",
            "Consider adding doctors or slots", "CLINIC", c["clinic_id"],
            "View Clinic", f"/admin/clinics/{c['clinic_id']}",
        )

    # INFORMATION: today's activity
    approved_today = query(
        "SELECT COUNT(*) c FROM doctor_applications WHERE status='APPROVED' AND DATE(reviewed_at)=CURDATE()",
        fetchone=True,
    )["c"]
    if approved_today:
        _upsert_alert(
            "INFORMATION", "DOCTORS_APPROVED_TODAY",
            f"{approved_today} doctor(s) approved today",
            None, None, None, None, None,
        )
    new_apps_today = query(
        "SELECT COUNT(*) c FROM doctor_applications WHERE DATE(created_at)=CURDATE()",
        fetchone=True,
    )["c"]
    if new_apps_today:
        _upsert_alert(
            "INFORMATION", "APPLICATIONS_RECEIVED_TODAY",
            f"{new_apps_today} new application(s) received today",
            None, None, None, None, None,
        )

    return list_alerts()


def list_alerts(include_resolved=False):
    where = "" if include_resolved else "WHERE is_resolved=0"
    rows = query(
        f"SELECT * FROM admin_alerts {where} ORDER BY FIELD(severity,'URGENT','ATTENTION','INFORMATION'), created_at DESC"
    )
    grouped = {"URGENT": [], "ATTENTION": [], "INFORMATION": []}
    for r in rows:
        grouped[r["severity"]].append(r)
    return grouped


def mark_read(alert_id):
    execute("UPDATE admin_alerts SET is_read=1 WHERE id=%s", (alert_id,))


def resolve_alert(alert_id, admin_user_id):
    execute(
        "UPDATE admin_alerts SET is_resolved=1, resolved_by_admin_id=%s, resolved_at=NOW() WHERE id=%s",
        (admin_user_id, alert_id),
    )


def resolve_by_entity(entity_type, entity_id, admin_user_id=None):
    """Called by other modules (e.g. application approved) to auto-resolve
    alerts that no longer apply."""
    execute(
        """UPDATE admin_alerts SET is_resolved=1, resolved_by_admin_id=%s, resolved_at=NOW()
           WHERE entity_type=%s AND entity_id=%s AND is_resolved=0""",
        (admin_user_id, entity_type, entity_id),
    )
