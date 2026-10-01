"""Application Timeline (spec feature #9). Append-only — no update/delete
is ever exposed for this table, matching the project's audit_logs convention."""
from app.utils.db import query, execute

STEP_ORDER = [
    "SUBMITTED", "DOCUMENTS_UPLOADED", "ADMIN_REVIEW", "DOCUMENTS_VERIFIED",
    "ORGANIZATION_ASSIGNED", "APPROVED", "DOCTOR_ACTIVE",
]


def add_event(application_id, step_key, performed_by_admin_id=None, comment=None,
              status="DONE", metadata=None):
    import json
    return execute(
        """INSERT INTO application_timeline_events
           (application_id, step_key, status, performed_by_admin_id, comment, metadata)
           VALUES (%s,%s,%s,%s,%s,%s)""",
        (application_id, step_key, status, performed_by_admin_id, comment,
         json.dumps(metadata) if metadata else None),
    )


def get_timeline(application_id):
    events = query(
        """SELECT te.*, u.email AS performed_by_email FROM application_timeline_events te
           LEFT JOIN users u ON u.id = te.performed_by_admin_id
           WHERE te.application_id=%s ORDER BY te.created_at ASC, te.id ASC""",
        (application_id,),
    )
    done_steps = {e["step_key"] for e in events if e["status"] == "DONE"}
    steps = []
    for key in STEP_ORDER:
        matching = [e for e in events if e["step_key"] == key]
        steps.append({
            "step_key": key,
            "status": "DONE" if key in done_steps else "PENDING",
            "events": matching,
        })
    # REJECTED is a branch off the normal sequence, shown only if it happened
    rejected_events = [e for e in events if e["step_key"] == "REJECTED"]
    return {"steps": steps, "rejected_events": rejected_events, "raw_events": events}
