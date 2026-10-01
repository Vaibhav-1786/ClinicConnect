import datetime

from app.utils.db import query


def generate_slots(doctor_id: int, clinic_id: int, date_str: str):
    """Return list of {time, available} slots for a doctor at a clinic on a given date,
    based on doctor_availability, doctor_leaves, appointment_duration, and existing appointments."""
    the_date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()

    if the_date < datetime.date.today():
        return []

    on_leave = query(
        "SELECT id FROM doctor_leaves WHERE doctor_id=%s AND leave_date=%s",
        (doctor_id, the_date), fetchone=True,
    )
    if on_leave:
        return []

    doctor = query("SELECT appointment_duration_minutes FROM doctors WHERE id=%s", (doctor_id,), fetchone=True)
    duration = (doctor or {}).get("appointment_duration_minutes") or 15

    day_of_week = the_date.weekday()  # 0=Mon
    windows = query(
        """SELECT start_time, end_time FROM doctor_availability
           WHERE doctor_id=%s AND clinic_id=%s AND day_of_week=%s""",
        (doctor_id, clinic_id, day_of_week),
    )
    if not windows:
        return []

    booked = query(
        """SELECT appointment_time FROM appointments
           WHERE doctor_id=%s AND appointment_date=%s AND status NOT IN ('CANCELLED','NO_SHOW')""",
        (doctor_id, the_date),
    )
    booked_times = {str(b["appointment_time"]) for b in booked}

    now = datetime.datetime.now()
    slots = []
    for w in windows:
        start = _to_datetime(the_date, w["start_time"])
        end = _to_datetime(the_date, w["end_time"])
        cursor = start
        while cursor + datetime.timedelta(minutes=duration) <= end:
            time_str = cursor.strftime("%H:%M:%S")
            is_past = the_date == datetime.date.today() and cursor <= now
            slots.append({
                "time": cursor.strftime("%H:%M"),
                "available": (time_str not in booked_times) and not is_past,
            })
            cursor += datetime.timedelta(minutes=duration)
    return slots


def _to_datetime(the_date, time_val):
    # app.utils.db.query() normalizes MySQL TIME columns (returned by the
    # connector as datetime.timedelta) into "HH:MM:SS" strings before handing
    # rows back, so by the time it reaches here time_val is usually already a
    # string. Handle all three shapes defensively.
    if isinstance(time_val, datetime.timedelta):
        total_seconds = int(time_val.total_seconds())
        h, rem = divmod(total_seconds, 3600)
        m, s = divmod(rem, 60)
        time_val = datetime.time(h, m, s)
    elif isinstance(time_val, str):
        parts = time_val.split(":")
        h, m = int(parts[0]), int(parts[1])
        s = int(parts[2]) if len(parts) > 2 else 0
        time_val = datetime.time(h, m, s)
    return datetime.datetime.combine(the_date, time_val)
