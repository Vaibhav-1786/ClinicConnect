"""
AI Admin Assistant (spec feature #3).

Design constraints from the spec, enforced here rather than left to the
model's good behavior:
  - The model NEVER writes or runs SQL. It only ever returns one of a small
    whitelist of `intent` values + simple filter fields (see INTENTS below).
    The backend maps that to a fixed, parameterized, read-only query.
  - This endpoint is entirely read-only. There is no code path here that can
    delete, approve, reject, or otherwise modify a record. Any admin who
    wants to act on a result clicks through to the normal admin screens
    (which already require the usual confirmation dialogs) — the AI only
    ever proposes navigation, never performs the mutation itself.
  - The assistant runs with exactly the querying power of an authenticated
    admin — no query here reaches beyond what /api/admin/* already exposes.
  - Every query + result summary is written to ai_admin_activity_log.
"""
import json

import requests as http
from flask import Blueprint, request, jsonify, g

from app.utils.db import query
from app.utils.auth import require_auth
from config import Config

bp = Blueprint("ai_admin", __name__, url_prefix="/api/admin/ai")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_MESSAGE_LEN = 2000

INTENTS = {
    "SEARCH_DOCTORS", "SEARCH_ORGANIZATIONS", "SEARCH_APPLICATIONS",
    "SEARCH_APPOINTMENTS", "SEARCH_DOCUMENTS_EXPIRING", "SEARCH_MULTI_CLINIC_DOCTORS",
    "SEARCH_OVERLOADED_CLINICS", "UNKNOWN",
}

SYSTEM_PROMPT = """You are the Admin Assistant for a clinic/hospital management system's admin \
dashboard. You NEVER write SQL and you NEVER take an action yourself — you only classify the \
admin's request into a JSON object describing what to look up.

Respond with ONLY a JSON object (no prose, no markdown fences) shaped exactly like:
{"intent": "<one of the allowed intents>", "filters": { ... }, "reply_text": "<one short sentence>"}

Allowed intents and their filters (all filters optional, omit what wasn't asked):
- SEARCH_DOCTORS: {"city": str, "specialization": str, "max_appointments_today": int, "verification_status": "PENDING"|"UNDER_REVIEW"|"APPROVED"|"REJECTED"}
- SEARCH_ORGANIZATIONS: {"min_utilization_pct": number, "city": str}
- SEARCH_APPLICATIONS: {"status": "PENDING"|"UNDER_REVIEW"|"APPROVED"|"REJECTED", "older_than_days": int}
- SEARCH_APPOINTMENTS: {"status": "CONFIRMED"|"CHECKED_IN"|"IN_CONSULTATION"|"COMPLETED"|"CANCELLED"|"NO_SHOW", "clinic_name": str}
- SEARCH_DOCUMENTS_EXPIRING: {"within_days": int}
- SEARCH_MULTI_CLINIC_DOCTORS: {"min_organizations": int}
- SEARCH_OVERLOADED_CLINICS: {"min_utilization_pct": number}
- UNKNOWN: use this if the request doesn't match any of the above, or asks you to take a \
  destructive/mutating action (delete, approve, reject, edit) — you can never perform those \
  yourself; reply_text should tell the admin to use the relevant screen instead. Also use this \
  intent for greetings, small talk, or anything unrelated to clinic data (e.g. "hi", "bye", \
  "how are you") — reply_text should be a short, friendly, natural reply in that case.

You MUST always respond with exactly one JSON object as described above, in every case, including \
greetings and small talk — never respond with plain prose, and never wrap the JSON in markdown \
code fences.

"reply_text" is a short, friendly one-sentence acknowledgement of what you're about to look up \
(the actual result count/list is filled in by the backend afterward, not by you)."""


def _call_model(message):
    resp = http.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {Config.OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": Config.OPENROUTER_SITE_URL,
            "X-Title": Config.OPENROUTER_APP_NAME,
        },
        json={
            "model": Config.OPENROUTER_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": message},
            ],
            "temperature": 0.1,
            "max_tokens": 300,
        },
        timeout=25,
    )
    resp.raise_for_status()
    text = resp.json()["choices"][0]["message"]["content"].strip()
    return _extract_json(text)


def _extract_json(text):
    """Best-effort extraction of a JSON object from a model reply.

    Models occasionally wrap the JSON in markdown fences, add a language tag,
    or add stray text before/after the object (especially for small-talk like
    "hi" / "bye" that don't cleanly match one of our intents). Rather than
    surfacing a hard error to the admin for those cases, try a few forgiving
    strategies before giving up.
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except (ValueError, TypeError):
        pass

    # Fall back to grabbing the first {...} block anywhere in the text.
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = cleaned[start:end + 1]
        try:
            return json.loads(candidate)
        except (ValueError, TypeError):
            pass

    # No parseable JSON at all — treat as small talk / unrecognized request
    # rather than an error, using the raw reply as the friendly text.
    return {"intent": "UNKNOWN", "filters": None, "reply_text": cleaned[:300] or None}


def _run_intent(intent, filters):
    filters = filters or {}

    if intent == "SEARCH_DOCTORS":
        where, params = ["1=1"], []
        if filters.get("city"):
            where.append("ci.name LIKE %s"); params.append(f"%{filters['city']}%")
        if filters.get("specialization"):
            where.append("d.specialization LIKE %s"); params.append(f"%{filters['specialization']}%")
        if filters.get("verification_status"):
            where.append("d.verification_status=%s"); params.append(filters["verification_status"])
        rows = query(
            f"""SELECT d.id, d.doctor_code, d.full_name, d.specialization, d.verification_status,
                       ci.name AS city_name,
                       (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id=d.id AND a.appointment_date=CURDATE()) AS appointments_today
                FROM doctors d LEFT JOIN cities ci ON ci.id = d.city_id
                WHERE {' AND '.join(where)} LIMIT 100""",
            params,
        )
        if filters.get("max_appointments_today") is not None:
            rows = [r for r in rows if r["appointments_today"] <= filters["max_appointments_today"]]
        return rows, "doctors"

    if intent == "SEARCH_ORGANIZATIONS":
        from app.services.capacity import compute_clinic_capacity
        where, params = ["c.status='active'"], []
        if filters.get("city"):
            where.append("ci.name LIKE %s"); params.append(f"%{filters['city']}%")
        clinics = query(
            f"""SELECT c.id, c.name, c.org_type, ci.name AS city_name FROM clinics c
                LEFT JOIN cities ci ON ci.id = c.city_id WHERE {' AND '.join(where)} LIMIT 100""",
            params,
        )
        results = []
        for c in clinics:
            cap = compute_clinic_capacity(c["id"])
            if cap and (filters.get("min_utilization_pct") is None
                        or cap["utilization_pct"] >= filters["min_utilization_pct"]):
                results.append({**c, "utilization_pct": cap["utilization_pct"]})
        return results, "organizations"

    if intent == "SEARCH_APPLICATIONS":
        where, params = ["1=1"], []
        if filters.get("status"):
            where.append("status=%s"); params.append(filters["status"])
        if filters.get("older_than_days"):
            where.append("created_at <= DATE_SUB(NOW(), INTERVAL %s DAY)"); params.append(filters["older_than_days"])
        rows = query(
            f"SELECT id, full_name, clinic_name, status, created_at FROM doctor_applications "
            f"WHERE {' AND '.join(where)} ORDER BY created_at DESC LIMIT 100",
            params,
        )
        return rows, "applications"

    if intent == "SEARCH_APPOINTMENTS":
        where, params = ["1=1"], []
        if filters.get("status"):
            where.append("a.status=%s"); params.append(filters["status"])
        if filters.get("clinic_name"):
            where.append("c.name LIKE %s"); params.append(f"%{filters['clinic_name']}%")
        rows = query(
            f"""SELECT a.id, a.appointment_date, a.appointment_time, a.status,
                       d.full_name AS doctor_name, c.name AS clinic_name
                FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN clinics c ON c.id = a.clinic_id
                WHERE {' AND '.join(where)} ORDER BY a.appointment_date DESC LIMIT 100""",
            params,
        )
        return rows, "appointments"

    if intent == "SEARCH_DOCUMENTS_EXPIRING":
        within_days = filters.get("within_days", 30)
        rows = query(
            """SELECT dd.id, dd.doc_type, dd.expiry_date, d.full_name, d.doctor_code
               FROM doctor_documents dd JOIN doctors d ON d.id = dd.doctor_id
               WHERE dd.expiry_date IS NOT NULL
                     AND dd.expiry_date <= DATE_ADD(CURDATE(), INTERVAL %s DAY)
               ORDER BY dd.expiry_date ASC LIMIT 100""",
            (within_days,),
        )
        return rows, "documents"

    if intent == "SEARCH_MULTI_CLINIC_DOCTORS":
        min_orgs = filters.get("min_organizations", 2)
        rows = query(
            """SELECT d.id, d.doctor_code, d.full_name, COUNT(cd.clinic_id) AS organization_count
               FROM doctors d JOIN clinic_doctors cd ON cd.doctor_id = d.id AND cd.status='active'
               GROUP BY d.id HAVING organization_count > %s
               ORDER BY organization_count DESC LIMIT 100""",
            (min_orgs - 1,),
        )
        return rows, "doctors"

    if intent == "SEARCH_OVERLOADED_CLINICS":
        from app.services.capacity import overloaded_clinics
        threshold = filters.get("min_utilization_pct", 80.0)
        return overloaded_clinics(threshold_pct=threshold), "clinics"

    return [], None


@bp.post("/chat")
@require_auth(["admin"])
def chat():
    if not Config.OPENROUTER_API_KEY:
        return jsonify({"error": "The AI assistant is not configured on this server yet."}), 503

    data = request.get_json(force=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Message cannot be empty"}), 400
    if len(message) > MAX_MESSAGE_LEN:
        return jsonify({"error": f"Message is too long (max {MAX_MESSAGE_LEN} characters)"}), 400

    try:
        parsed = _call_model(message)
    except http.exceptions.Timeout:
        return jsonify({"error": "The AI assistant took too long to respond. Please try again."}), 504
    except http.exceptions.RequestException:
        return jsonify({"error": "Could not reach the AI service. Please try again."}), 502
    except (ValueError, KeyError, IndexError, TypeError):
        return jsonify({"error": "The AI assistant returned an unexpected response. Please try again."}), 502

    intent = parsed.get("intent") if isinstance(parsed, dict) else None
    if intent not in INTENTS:
        intent = "UNKNOWN"
    filters = parsed.get("filters") if isinstance(parsed, dict) else None
    reply_text = (parsed.get("reply_text") if isinstance(parsed, dict) else None) or ""

    if intent == "UNKNOWN":
        results, result_kind = [], None
        summary = reply_text or (
            "I can only look up doctors, organizations, applications, appointments, documents, "
            "and related records for you — for approvals, rejections, or edits, please use the "
            "relevant admin screen so you can confirm the action there."
        )
    else:
        results, result_kind = _run_intent(intent, filters)
        summary = f"Found {len(results)} {result_kind or 'result(s)'}."

    from app.utils.db import execute
    execute(
        """INSERT INTO ai_admin_activity_log
           (admin_user_id, query_text, interpreted_intent, applied_filters, result_summary)
           VALUES (%s,%s,%s,%s,%s)""",
        (g.user_id, message[:2000], intent, json.dumps(filters) if filters else None, summary),
    )

    return jsonify({
        "reply": reply_text or summary,
        "intent": intent,
        "filters": filters,
        "result_kind": result_kind,
        "results": results,
        "result_count": len(results),
    })


@bp.get("/activity-log")
@require_auth(["admin"])
def ai_activity_log():
    page = max(request.args.get("page", 1, type=int), 1)
    page_size = min(request.args.get("page_size", 25, type=int), 100)
    offset = (page - 1) * page_size
    total = query("SELECT COUNT(*) c FROM ai_admin_activity_log", fetchone=True)["c"]
    rows = query(
        """SELECT al.*, u.email FROM ai_admin_activity_log al JOIN users u ON u.id = al.admin_user_id
           ORDER BY al.created_at DESC LIMIT %s OFFSET %s""",
        (page_size, offset),
    )
    return jsonify({"total": total, "page": page, "page_size": page_size, "logs": rows})