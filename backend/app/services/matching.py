"""
Doctor <-> Organization matching / recommendation engine.

Reusable from: doctor creation, application review, organization assignment,
and multi-clinic management (spec features #1 and #18). Every score is
explainable — callers get back the per-factor breakdown and a list of
human-readable reasons, not just a number.
"""
import json

from app.utils.db import query
from app.services.geo import haversine_km, distance_score

MAX_MATCH_DISTANCE_KM = 25.0


def _active_weight_profile():
    profile = query(
        "SELECT * FROM match_weight_profiles WHERE is_active=1 ORDER BY id LIMIT 1",
        fetchone=True,
    )
    if not profile:
        profile = query("SELECT * FROM match_weight_profiles WHERE id=1", fetchone=True)
    return profile


def _clinic_stats(clinic_id):
    """Doctor count, specialization count, appointment demand, available slots."""
    doctor_count = query(
        "SELECT COUNT(*) c FROM clinic_doctors WHERE clinic_id=%s AND status='active'",
        (clinic_id,), fetchone=True,
    )["c"]
    spec_count = query(
        """SELECT COUNT(DISTINCT d.specialization) c FROM clinic_doctors cd
           JOIN doctors d ON d.id = cd.doctor_id
           WHERE cd.clinic_id=%s AND cd.status='active' AND d.specialization IS NOT NULL""",
        (clinic_id,), fetchone=True,
    )["c"]
    appts_30d = query(
        """SELECT COUNT(*) c FROM appointments
           WHERE clinic_id=%s AND appointment_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)""",
        (clinic_id,), fetchone=True,
    )["c"]
    slot_rows = query(
        "SELECT COUNT(*) c FROM doctor_availability WHERE clinic_id=%s AND is_active=1",
        (clinic_id,), fetchone=True,
    )["c"]
    return {
        "doctor_count": doctor_count,
        "specialization_count": spec_count,
        "appointments_last_30d": appts_30d,
        "availability_slots": slot_rows,
    }


def _specialization_score(doctor_specialization, clinic_id, stats):
    if not doctor_specialization:
        return 50.0, "No specialization on file to match against"
    has_match = query(
        """SELECT COUNT(*) c FROM clinic_doctors cd JOIN doctors d ON d.id = cd.doctor_id
           WHERE cd.clinic_id=%s AND cd.status='active' AND d.specialization=%s""",
        (clinic_id, doctor_specialization), fetchone=True,
    )["c"] > 0
    if has_match:
        return 100.0, f"{doctor_specialization} department already available"
    if stats["specialization_count"] == 0:
        return 40.0, "No specialists on staff yet at this organization"
    return 60.0, f"Different specialization mix (no existing {doctor_specialization})"


def _availability_score(stats):
    slots = stats["availability_slots"]
    if slots == 0:
        return 30.0, "No published consultation slots yet"
    if slots >= 10:
        return 100.0, "Ample available consultation slots"
    return round(30 + slots * 7, 2), f"{slots} consultation slot(s) currently published"


def _capacity_score(stats):
    doctors = stats["doctor_count"]
    if doctors == 0:
        return 70.0, "No existing doctors — plenty of room"
    if doctors <= 10:
        return 90.0, "Good capacity, room to grow"
    if doctors <= 25:
        return 70.0, "Moderate capacity"
    return 40.0, "High existing doctor count — capacity is tighter"


def _distribution_score(doctor_specialization, stats):
    if stats["doctor_count"] == 0:
        return 100.0, "First doctor at this organization"
    if not doctor_specialization:
        return 60.0, "Existing doctor distribution is balanced"
    return 80.0, "Reasonable specialization distribution"


def _location_score(doctor_city_id, doctor_area_id, clinic):
    if doctor_area_id and clinic.get("area_id") == doctor_area_id:
        return 100.0, "Same area as the doctor"
    if doctor_city_id and clinic.get("city_id") == doctor_city_id:
        return 75.0, "Same city as the doctor"
    return 30.0, "Different city from the doctor"


def score_organization(clinic_id, doctor_specialization=None, doctor_city_id=None,
                        doctor_area_id=None, doctor_lat=None, doctor_lon=None,
                        weight_profile=None):
    """Compute one explainable match score for a single clinic/hospital."""
    clinic = query("SELECT * FROM clinics WHERE id=%s", (clinic_id,), fetchone=True)
    if not clinic:
        return None
    weight_profile = weight_profile or _active_weight_profile()
    stats = _clinic_stats(clinic_id)

    loc_score, loc_reason = _location_score(doctor_city_id, doctor_area_id, clinic)
    spec_score, spec_reason = _specialization_score(doctor_specialization, clinic_id, stats)
    avail_score, avail_reason = _availability_score(stats)
    cap_score, cap_reason = _capacity_score(stats)
    dist_km = haversine_km(doctor_lat, doctor_lon, clinic.get("latitude"), clinic.get("longitude"))
    dkm_score = distance_score(dist_km, MAX_MATCH_DISTANCE_KM)
    distro_score, distro_reason = _distribution_score(doctor_specialization, stats)

    w = weight_profile
    total = (
        loc_score * float(w["location_weight"])
        + spec_score * float(w["specialization_weight"])
        + avail_score * float(w["availability_weight"])
        + cap_score * float(w["capacity_weight"])
        + dkm_score * float(w["distance_weight"])
        + distro_score * float(w["doctor_distribution_weight"])
    ) / 100.0

    reasons = [loc_reason, spec_reason, avail_reason, cap_reason, distro_reason]
    if dist_km is not None:
        reasons.append(f"{dist_km:.1f} km away" if dist_km >= 1 else "Less than 1 km away")
    if clinic.get("approval_status") == "APPROVED":
        reasons.append("Organization is verified")

    return {
        "clinic_id": clinic_id,
        "clinic_name": clinic["name"],
        "org_type": clinic["org_type"],
        "match_score": round(min(total, 100.0), 2),
        "distance_km": round(dist_km, 2) if dist_km is not None else None,
        "breakdown": {
            "location_score": loc_score, "specialization_score": spec_score,
            "availability_score": avail_score, "capacity_score": cap_score,
            "distance_score": dkm_score, "distribution_score": distro_score,
        },
        "reasons": reasons,
        "current_doctors": stats["doctor_count"],
        "weight_profile_id": w["id"],
    }


def recommend_organizations(doctor_specialization=None, doctor_city_id=None, doctor_area_id=None,
                             doctor_lat=None, doctor_lon=None, limit=10, exclude_clinic_ids=None):
    """Rank all approved, active organizations for a doctor's profile."""
    exclude_clinic_ids = exclude_clinic_ids or []
    clinics = query(
        "SELECT id FROM clinics WHERE status='active' AND approval_status='APPROVED'"
    )
    weight_profile = _active_weight_profile()
    results = []
    for c in clinics:
        if c["id"] in exclude_clinic_ids:
            continue
        result = score_organization(
            c["id"], doctor_specialization, doctor_city_id, doctor_area_id,
            doctor_lat, doctor_lon, weight_profile,
        )
        if result:
            results.append(result)
    results.sort(key=lambda r: r["match_score"], reverse=True)
    return results[:limit]


def persist_recommendations(results, doctor_id=None, application_id=None):
    """Cache computed recommendations so they can be inspected/audited later."""
    from app.utils.db import execute
    for r in results:
        execute(
            """INSERT INTO organization_recommendations
               (doctor_id, application_id, clinic_id, match_score, location_score,
                specialization_score, availability_score, capacity_score, distance_score,
                distribution_score, distance_km, reasons, weight_profile_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (
                doctor_id, application_id, r["clinic_id"], r["match_score"],
                r["breakdown"]["location_score"], r["breakdown"]["specialization_score"],
                r["breakdown"]["availability_score"], r["breakdown"]["capacity_score"],
                r["breakdown"]["distance_score"], r["breakdown"]["distribution_score"],
                r["distance_km"], json.dumps(r["reasons"]), r["weight_profile_id"],
            ),
        )
