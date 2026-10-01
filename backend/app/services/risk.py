"""Application Risk Score (spec feature #20). Purely advisory: nothing in
this module ever changes an application's status. Admins always decide."""
import datetime
import json

from app.utils.db import query, execute

RISK_POINTS = {
    "duplicate_registration_number": 30,
    "duplicate_mobile": 20,
    "incomplete_documents": 15,
    "multiple_organizations_requested": 10,
    "location_mismatch": 10,
    "expiring_or_expired_certificate": 15,
    "very_new_registration": 10,
}


def _risk_level(score):
    if score <= 20:
        return "LOW"
    if score <= 50:
        return "MODERATE"
    if score <= 75:
        return "HIGH"
    return "CRITICAL"


def compute_application_risk(application):
    """`application` is a dict row from doctor_applications."""
    factors = []
    score = 0

    if application.get("registration_number"):
        dup = query(
            "SELECT COUNT(*) c FROM doctors WHERE registration_number=%s",
            (application["registration_number"],), fetchone=True,
        )["c"]
        if dup:
            score += RISK_POINTS["duplicate_registration_number"]
            factors.append("Registration number matches another existing account")

    if application.get("mobile"):
        dup = query(
            """SELECT COUNT(*) c FROM (
                 SELECT mobile FROM doctors WHERE mobile=%s
                 UNION ALL
                 SELECT mobile FROM doctor_applications WHERE mobile=%s AND id != %s
               ) x""",
            (application["mobile"], application["mobile"], application["id"]), fetchone=True,
        )["c"]
        if dup:
            score += RISK_POINTS["duplicate_mobile"]
            factors.append("Phone number appears on another account or application")

    required_doc_types = {"degree_certificate", "medical_registration_certificate", "identity_proof"}
    uploaded = {
        r["doc_type"] for r in query(
            "SELECT DISTINCT doc_type FROM doctor_documents WHERE application_id=%s",
            (application["id"],),
        )
    }
    if not required_doc_types.issubset(uploaded):
        score += RISK_POINTS["incomplete_documents"]
        missing = required_doc_types - uploaded
        factors.append(f"Missing required document(s): {', '.join(sorted(missing))}")

    if application.get("existing_clinic_id"):
        existing_orgs = query(
            """SELECT COUNT(*) c FROM clinic_doctors cd
               JOIN doctors d ON d.id = cd.doctor_id
               WHERE d.mobile=%s AND cd.status='active'""",
            (application.get("mobile"),), fetchone=True,
        )["c"] if application.get("mobile") else 0
        if existing_orgs > 2:
            score += RISK_POINTS["multiple_organizations_requested"]
            factors.append("Doctor is already linked to more than two organizations")

    if application.get("existing_clinic_id") and application.get("city_id"):
        clinic = query("SELECT city_id FROM clinics WHERE id=%s", (application["existing_clinic_id"],), fetchone=True)
        if clinic and clinic["city_id"] and clinic["city_id"] != application["city_id"]:
            score += RISK_POINTS["location_mismatch"]
            factors.append("Doctor's stated location differs from the selected organization's city")

    expiring_docs = query(
        """SELECT COUNT(*) c FROM doctor_documents
           WHERE application_id=%s AND expiry_date IS NOT NULL
                 AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)""",
        (application["id"],), fetchone=True,
    )["c"]
    if expiring_docs:
        score += RISK_POINTS["expiring_or_expired_certificate"]
        factors.append("An uploaded document is expired or expires within 30 days")

    if application.get("registration_year"):
        current_year = datetime.date.today().year
        try:
            if current_year - int(application["registration_year"]) < 1:
                score += RISK_POINTS["very_new_registration"]
                factors.append("Medical registration was issued less than a year ago")
        except (TypeError, ValueError):
            pass

    score = min(score, 100)
    return {"risk_score": score, "risk_level": _risk_level(score), "factors": factors}


def compute_and_store_risk(application_id):
    application = query("SELECT * FROM doctor_applications WHERE id=%s", (application_id,), fetchone=True)
    if not application:
        return None
    result = compute_application_risk(application)
    execute(
        "INSERT INTO application_risk_scores (application_id, risk_score, risk_level, factors) VALUES (%s,%s,%s,%s)",
        (application_id, result["risk_score"], result["risk_level"], json.dumps(result["factors"])),
    )
    return result


def get_latest_risk(application_id):
    return query(
        "SELECT * FROM application_risk_scores WHERE application_id=%s ORDER BY computed_at DESC LIMIT 1",
        (application_id,), fetchone=True,
    )
