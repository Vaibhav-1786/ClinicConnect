"""Duplicate Doctor Detection (spec feature #13). Only ever records
candidate matches + the admin's decision — merging or dismissing is always
an explicit, separate admin action; nothing here merges records automatically."""
import difflib

from app.utils.db import query, execute

# Relative weights for the overall match percentage. Exact identifiers
# (registration number, mobile, email) dominate; name/DOB are corroborating
# signals since names/birthdates alone are common collisions.
FACTOR_WEIGHTS = {
    "registration_number": 0.35,
    "mobile": 0.25,
    "email": 0.15,
    "name": 0.15,
    "dob": 0.10,
}


def _similarity(a, b):
    if not a or not b:
        return None
    a, b = str(a).strip().lower(), str(b).strip().lower()
    if not a or not b:
        return None
    return round(difflib.SequenceMatcher(None, a, b).ratio() * 100, 1)


def find_candidate_matches(full_name=None, mobile=None, email=None,
                            registration_number=None, dob=None, exclude_doctor_id=None):
    """Pull existing doctors sharing ANY strong identifier, then score each."""
    clauses, params = [], []
    if mobile:
        clauses.append("mobile=%s"); params.append(mobile)
    if registration_number:
        clauses.append("registration_number=%s"); params.append(registration_number)
    if full_name:
        clauses.append("full_name SOUNDS LIKE %s"); params.append(full_name)
    if not clauses:
        return []

    where = " OR ".join(clauses)
    exclude_sql = " AND id != %s" if exclude_doctor_id else ""
    if exclude_doctor_id:
        params.append(exclude_doctor_id)

    candidates = query(
        f"""SELECT d.*, u.email AS user_email, c.name AS clinic_name, c.id AS clinic_id
            FROM doctors d
            LEFT JOIN users u ON u.id = d.user_id
            LEFT JOIN clinic_doctors cd ON cd.doctor_id = d.id AND cd.status='active'
            LEFT JOIN clinics c ON c.id = cd.clinic_id
            WHERE ({where}){exclude_sql}""",
        params,
    )

    results = []
    seen_doctor_ids = set()
    for c in candidates:
        if c["id"] in seen_doctor_ids:
            continue
        seen_doctor_ids.add(c["id"])
        factors = {
            "name": _similarity(full_name, c["full_name"]),
            "registration_number": 100.0 if registration_number and c["registration_number"]
                                    and registration_number == c["registration_number"] else
                                    (0.0 if registration_number and c["registration_number"] else None),
            "mobile": 100.0 if mobile and c["mobile"] and mobile == c["mobile"] else
                      (0.0 if mobile and c["mobile"] else None),
            "email": _similarity(email, c.get("user_email")),
            "dob": 100.0 if dob and c["dob"] and str(dob) == str(c["dob"]) else
                   (0.0 if dob and c["dob"] else None),
        }
        weighted_sum, weight_total = 0.0, 0.0
        for factor, weight in FACTOR_WEIGHTS.items():
            value = factors.get(factor)
            if value is not None:
                weighted_sum += value * weight
                weight_total += weight
        overall = round(weighted_sum / weight_total, 1) if weight_total else 0.0
        if overall >= 50.0:
            results.append({
                "matched_doctor_id": c["id"],
                "matched_doctor_name": c["full_name"],
                "matched_doctor_code": c["doctor_code"],
                "existing_clinic_name": c.get("clinic_name"),
                "overall_match_pct": overall,
                "factors": factors,
            })
    results.sort(key=lambda r: r["overall_match_pct"], reverse=True)
    return results


def run_and_store_detection(application_id=None, doctor_id=None, full_name=None, mobile=None,
                             email=None, registration_number=None, dob=None):
    matches = find_candidate_matches(full_name, mobile, email, registration_number, dob,
                                      exclude_doctor_id=doctor_id)
    stored = []
    for m in matches:
        row_id = execute(
            """INSERT INTO duplicate_detection_results
               (application_id, doctor_id, matched_doctor_id, overall_match_pct,
                name_match_pct, registration_number_match_pct, mobile_match_pct,
                email_match_pct, dob_match_pct)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (
                application_id, doctor_id, m["matched_doctor_id"], m["overall_match_pct"],
                m["factors"]["name"], m["factors"]["registration_number"], m["factors"]["mobile"],
                m["factors"]["email"], m["factors"]["dob"],
            ),
        )
        m["result_id"] = row_id
        stored.append(m)
    return stored


def record_admin_decision(result_id, decision, admin_user_id):
    """decision in ('VIEWED_EXISTING','CONTINUED_ANYWAY','MERGED'). Merging the
    actual doctor records themselves, if chosen, must happen via a separate,
    explicit admin-only endpoint — this only records the decision."""
    execute(
        "UPDATE duplicate_detection_results SET admin_decision=%s, decided_by_admin_id=%s, decided_at=NOW() WHERE id=%s",
        (decision, admin_user_id, result_id),
    )
