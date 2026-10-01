"""Clinic Capacity Dashboard service (spec feature #7)."""
import datetime

from app.utils.db import query, execute


def _capacity_level(utilization_pct):
    if utilization_pct <= 50:
        return "LOW"
    if utilization_pct <= 75:
        return "NORMAL"
    if utilization_pct <= 90:
        return "HIGH"
    return "CRITICAL"


def compute_clinic_capacity(clinic_id, on_date=None):
    on_date = on_date or datetime.date.today()
    clinic = query("SELECT * FROM clinics WHERE id=%s", (clinic_id,), fetchone=True)
    if not clinic:
        return None

    doctor_count = query(
        "SELECT COUNT(*) c FROM clinic_doctors WHERE clinic_id=%s AND status='active'",
        (clinic_id,), fetchone=True,
    )["c"]
    department_count = query(
        """SELECT COUNT(DISTINCT d.specialization) c FROM clinic_doctors cd
           JOIN doctors d ON d.id = cd.doctor_id
           WHERE cd.clinic_id=%s AND cd.status='active' AND d.specialization IS NOT NULL""",
        (clinic_id,), fetchone=True,
    )["c"]
    appointments_count = query(
        "SELECT COUNT(*) c FROM appointments WHERE clinic_id=%s AND appointment_date=%s",
        (clinic_id, on_date), fetchone=True,
    )["c"]

    # Booked slots for the day, per doctor, based on the doctor's clinic-specific
    # appointment_duration and their published availability windows for that weekday.
    day_of_week = on_date.weekday()  # 0=Mon .. 6=Sun, matches doctor_availability.day_of_week
    slot_rows = query(
        """SELECT da.doctor_id, da.start_time, da.end_time, d.appointment_duration_minutes
           FROM doctor_availability da JOIN doctors d ON d.id = da.doctor_id
           WHERE da.clinic_id=%s AND da.day_of_week=%s AND da.is_active=1""",
        (clinic_id, day_of_week),
    )
    total_slots = 0
    for row in slot_rows:
        duration = row["appointment_duration_minutes"] or 15
        start = row["start_time"]
        end = row["end_time"]
        start_minutes = _to_minutes(start)
        end_minutes = _to_minutes(end)
        if end_minutes > start_minutes and duration > 0:
            total_slots += (end_minutes - start_minutes) // duration

    available_slots = max(total_slots - appointments_count, 0)
    utilization_pct = round((appointments_count / total_slots) * 100, 2) if total_slots else 0.0
    utilization_pct = min(utilization_pct, 100.0)

    return {
        "clinic_id": clinic_id,
        "clinic_name": clinic["name"],
        "doctor_count": doctor_count,
        "department_count": department_count,
        "appointments_count": appointments_count,
        "total_slots": total_slots,
        "available_slots": available_slots,
        "utilization_pct": utilization_pct,
        "capacity_level": _capacity_level(utilization_pct),
    }


def _to_minutes(t):
    """Accept both datetime.time and 'HH:MM:SS' string (db util normalizes TIME to string)."""
    if isinstance(t, str):
        parts = t.split(":")
        return int(parts[0]) * 60 + int(parts[1])
    return t.hour * 60 + t.minute


def snapshot_clinic_capacity(clinic_id, on_date=None):
    """Compute + persist today's capacity so trend queries have real history."""
    on_date = on_date or datetime.date.today()
    result = compute_clinic_capacity(clinic_id, on_date)
    if result is None:
        return None
    existing = query(
        "SELECT id FROM clinic_capacity_snapshots WHERE clinic_id=%s AND snapshot_date=%s",
        (clinic_id, on_date), fetchone=True,
    )
    args = (
        result["doctor_count"], result["department_count"], result["appointments_count"],
        result["available_slots"], result["utilization_pct"], result["capacity_level"],
    )
    if existing:
        execute(
            """UPDATE clinic_capacity_snapshots SET doctor_count=%s, department_count=%s,
               appointments_count=%s, available_slots=%s, utilization_pct=%s, capacity_level=%s
               WHERE id=%s""",
            args + (existing["id"],),
        )
    else:
        execute(
            """INSERT INTO clinic_capacity_snapshots
               (clinic_id, snapshot_date, doctor_count, department_count, appointments_count,
                available_slots, utilization_pct, capacity_level)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
            (clinic_id, on_date) + args,
        )
    return result


def capacity_trend(clinic_id, days=7):
    return query(
        """SELECT snapshot_date, utilization_pct, capacity_level FROM clinic_capacity_snapshots
           WHERE clinic_id=%s ORDER BY snapshot_date DESC LIMIT %s""",
        (clinic_id, days),
    )


def overloaded_clinics(threshold_pct=90.0, on_date=None):
    """Clinics currently at/over `threshold_pct` utilization, computed live."""
    on_date = on_date or datetime.date.today()
    clinics = query("SELECT id FROM clinics WHERE status='active' AND approval_status='APPROVED'")
    overloaded = []
    for c in clinics:
        result = compute_clinic_capacity(c["id"], on_date)
        if result and result["utilization_pct"] >= threshold_pct:
            overloaded.append(result)
    overloaded.sort(key=lambda r: r["utilization_pct"], reverse=True)
    return overloaded
