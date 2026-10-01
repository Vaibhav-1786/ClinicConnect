"""
Shared-receptionist doctor scoping (see migration_018).

A receptionist already only ever sees data for their own clinic
(g.clinic_id, enforced throughout appointments.py/profiles.py). This
module adds one more, narrower layer on top: within that clinic, does
this receptionist have access to this particular doctor?

- access_type='ALL'        -> every doctor in the clinic (today's default
                               behaviour for every existing receptionist).
- access_type='DEPARTMENT' -> only doctors whose `department` is one of
                               the receptionist's assigned departments.
- access_type='SPECIFIC'   -> only doctors explicitly listed in
                               receptionist_doctor_access.

Always enforced server-side. Never trust a doctor_id supplied by the
frontend as proof of authorization.
"""
from app.utils.db import query


def get_receptionist_access(receptionist_id):
    row = query(
        "SELECT id, clinic_id, access_type FROM receptionists WHERE id=%s",
        (receptionist_id,), fetchone=True,
    )
    return row


def allowed_doctor_ids(receptionist_id, access_type):
    """Returns None to mean 'all doctors in the clinic' (no extra filter
    needed), or a (possibly empty) set of allowed doctor ids otherwise."""
    if access_type == "ALL":
        return None

    if access_type == "SPECIFIC":
        rows = query(
            "SELECT doctor_id FROM receptionist_doctor_access WHERE receptionist_id=%s",
            (receptionist_id,),
        )
        return {r["doctor_id"] for r in rows}

    if access_type == "DEPARTMENT":
        depts = [
            r["department"]
            for r in query(
                "SELECT department FROM receptionist_department_access WHERE receptionist_id=%s",
                (receptionist_id,),
            )
        ]
        if not depts:
            return set()
        placeholders = ",".join(["%s"] * len(depts))
        rows = query(
            f"SELECT id FROM doctors WHERE department IN ({placeholders})",
            tuple(depts),
        )
        return {r["id"] for r in rows}

    # Unknown/unset access_type: fail closed, not open.
    return set()


def receptionist_can_access_doctor(receptionist_id, access_type, clinic_id, doctor_id):
    """The doctor must first actually belong to the receptionist's clinic,
    then (if access is restricted) be within the receptionist's scope."""
    link = query(
        "SELECT id FROM clinic_doctors WHERE clinic_id=%s AND doctor_id=%s AND status='active'",
        (clinic_id, doctor_id), fetchone=True,
    )
    if not link:
        return False

    allowed = allowed_doctor_ids(receptionist_id, access_type)
    if allowed is None:
        return True
    return doctor_id in allowed


def doctor_filter_sql(receptionist_id, access_type, doctor_column="doctor_id"):
    """For list endpoints: returns (sql_fragment, params) to AND onto a
    WHERE clause, restricting rows to doctors this receptionist may see.
    sql_fragment is "" (no extra restriction) when access_type is 'ALL'."""
    allowed = allowed_doctor_ids(receptionist_id, access_type)
    if allowed is None:
        return "", []
    if not allowed:
        return f" AND 1=0", []
    placeholders = ",".join(["%s"] * len(allowed))
    return f" AND {doctor_column} IN ({placeholders})", list(allowed)
