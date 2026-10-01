import random
import secrets
import string
import datetime

from app.utils.db import execute, get_conn, query


def gen_code(prefix: str, length: int = 6) -> str:
    suffix = "".join(random.choices(string.digits, k=length))
    return f"{prefix}{suffix}"


def gen_sequential_code(prefix: str) -> str:
    """
    Atomically allocate the next sequential ID for a prefix, e.g. DOC-000001,
    CLN-000001, HOS-000001, REC-000001. Uses a row lock on id_counters so
    concurrent requests never receive the same number.
    """
    conn = get_conn()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT next_value FROM id_counters WHERE counter_key=%s FOR UPDATE", (prefix,))
        row = cur.fetchone()
        if row is None:
            cur.execute("INSERT INTO id_counters (counter_key, next_value) VALUES (%s, 2)", (prefix,))
            next_value = 1
        else:
            next_value = row["next_value"]
            cur.execute("UPDATE id_counters SET next_value=%s WHERE counter_key=%s", (next_value + 1, prefix))
        conn.commit()
        cur.close()
        return f"{prefix}-{next_value:06d}"
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def gen_temp_password(length: int = 10) -> str:
    """Generate a secure, human-typeable temporary password."""
    alphabet = string.ascii_letters + string.digits
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.islower() for c in pwd) and any(c.isupper() for c in pwd)
                and any(c.isdigit() for c in pwd)):
            return pwd


_MODULE_PREFIXES = [
    ("APPOINTMENT", "Appointments"), ("RECURRING", "Recurring Appointments"),
    ("WAITLIST", "Waitlist"), ("FAMILY_MEMBER", "Family"), ("INSURANCE", "Insurance"),
    ("MEDICINE_REMINDER", "Medicine Reminders"), ("PRESCRIPTION", "Prescriptions"),
    ("OPD", "Queue"), ("BULK_NOTIFICATION", "Notifications"), ("NOTIFICATION", "Notifications"),
    ("NOTE_TEMPLATE", "Clinical Notes"), ("CONSULTATION_NOTE", "Clinical Notes"),
    ("PATIENT_HISTORY", "Clinical Notes"), ("DOCTOR_", "Doctor Management"),
    ("CLINIC_", "Organization Management"), ("RECEPTIONIST_", "Receptionist Management"),
    ("APPLICATION", "Applications"), ("SWITCH_ORGANIZATION", "Organization Management"),
    ("LOGIN", "Authentication"), ("PASSWORD", "Authentication"),
    ("DOCUMENT_EXPIRY", "Document Management"),
]


def _derive_module(action):
    action = action or ""
    for prefix, label in _MODULE_PREFIXES:
        if action.startswith(prefix):
            return label
    return "General"


def add_audit(user_id, role, action, description="", ip_address=None, module=None, clinic_id=None):
    if module is None:
        module = _derive_module(action)
    if clinic_id is None:
        try:
            from flask import g
            clinic_id = getattr(g, "clinic_id", None)
        except RuntimeError:
            clinic_id = None  # called outside a request context (e.g. a script)
    execute(
        "INSERT INTO audit_logs (user_id, role, action, module, clinic_id, description, ip_address) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (user_id, role, action, module, clinic_id, description, ip_address),
    )


_NOTIF_CATEGORY_KEYWORDS = [
    ("appointment", ["appoint"]), ("payment", ["pay", "invoice", "bill", "refund"]),
    ("prescription", ["prescri", "medicine", "medication"]),
    ("laboratory", ["lab", "report"]), ("follow_up", ["follow"]),
    ("emergency", ["sos", "emergency"]),
]


def _derive_notification_category(ntype):
    ntype_lower = (ntype or "").lower()
    for category, keywords in _NOTIF_CATEGORY_KEYWORDS:
        if any(k in ntype_lower for k in keywords):
            return category
    return "system"


def add_notification(user_id, ntype, title, message, category=None):
    """Insert a notification unless the user has explicitly disabled this
    category in notification_preferences (absence of a row = enabled)."""
    category = category or _derive_notification_category(ntype)
    pref = query(
        "SELECT enabled FROM notification_preferences WHERE user_id=%s AND category=%s",
        (user_id, category), fetchone=True,
    )
    if pref is not None and not pref.get("enabled"):
        return
    execute(
        "INSERT INTO notifications (user_id, type, category, title, message) VALUES (%s,%s,%s,%s,%s)",
        (user_id, ntype, category, title, message),
    )


def today():
    return datetime.date.today()
