"""Predictive Appointment Analytics (spec feature #17). Deliberately simple
and transparent (trailing 4-week average vs. prior 4-week average) rather
than a black-box model, so admins can see exactly what drove a prediction.
Every result is clearly labeled with a confidence level — never presented
as a guaranteed fact."""
import datetime
import json

from app.utils.db import query, execute


def _weekly_volumes(where_sql, params, weeks=8):
    rows = query(
        f"""SELECT YEARWEEK(appointment_date, 3) AS yw, COUNT(*) AS c
            FROM appointments WHERE {where_sql}
                  AND appointment_date >= DATE_SUB(CURDATE(), INTERVAL %s WEEK)
            GROUP BY yw ORDER BY yw""",
        params + [weeks],
    )
    return [r["c"] for r in rows]


def _confidence_from_sample(volumes):
    """More weeks of stable-ish data -> higher stated confidence. Capped
    well below 100 since this is a simple trailing-average model, not a
    validated statistical forecast."""
    if len(volumes) < 4:
        return 40.0
    if len(volumes) < 8:
        return 55.0
    return 65.0


def forecast_appointments(scope_type="GLOBAL", scope_value=None, weeks_history=8):
    where, params = "1=1", []
    if scope_type == "CITY" and scope_value:
        where = "clinic_id IN (SELECT id FROM clinics WHERE city_id=%s)"
        params = [scope_value]
    elif scope_type == "SPECIALIZATION" and scope_value:
        where = "doctor_id IN (SELECT id FROM doctors WHERE specialization=%s)"
        params = [scope_value]
    elif scope_type == "CLINIC" and scope_value:
        where = "clinic_id=%s"
        params = [scope_value]

    volumes = _weekly_volumes(where, params, weeks_history)
    if not volumes:
        return None

    half = max(len(volumes) // 2, 1)
    older = volumes[:-half] or volumes
    recent = volumes[-half:]
    older_avg = sum(older) / len(older)
    recent_avg = sum(recent) / len(recent)

    if older_avg > 0:
        change_pct = round((recent_avg - older_avg) / older_avg * 100, 1)
    else:
        change_pct = 0.0 if recent_avg == 0 else 100.0

    predicted_volume = round(recent_avg * (1 + change_pct / 100), 1)
    confidence = _confidence_from_sample(volumes)

    recommendation = None
    if scope_type == "SPECIALIZATION" and scope_value and change_pct >= 15:
        extra_needed = max(1, round(recent_avg * (change_pct / 100) / 20))  # rough: 1 doctor per ~20 extra visits/wk
        recommendation = (
            f"Appointments for {scope_value} are trending up {change_pct}% — "
            f"consider adding about {extra_needed} more {scope_value} doctor(s) in this area."
        )
    elif change_pct >= 15:
        recommendation = f"Appointment volume is trending up {change_pct}% — monitor capacity closely."
    elif change_pct <= -15:
        recommendation = f"Appointment volume is trending down {abs(change_pct)}% — investigate cancellations/no-shows."

    today = datetime.date.today()
    period_start = today
    period_end = today + datetime.timedelta(days=30)

    result = {
        "scope_type": scope_type, "scope_value": scope_value,
        "historical_avg_volume": round(older_avg, 1),
        "predicted_volume": predicted_volume,
        "predicted_change_pct": change_pct,
        "confidence_pct": confidence,
        "recommendation_text": recommendation,
        "is_estimate": True,
        "factors": {
            "weekly_volumes_used": volumes,
            "weeks_of_history": len(volumes),
        },
        "forecast_period_start": period_start.isoformat(),
        "forecast_period_end": period_end.isoformat(),
    }

    execute(
        """INSERT INTO appointment_forecasts
           (scope_type, scope_value, forecast_period_start, forecast_period_end,
            historical_avg_volume, predicted_volume, predicted_change_pct, confidence_pct,
            recommendation_text, factors)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (
            scope_type, scope_value, period_start, period_end, result["historical_avg_volume"],
            predicted_volume, change_pct, confidence, recommendation,
            json.dumps(result["factors"]),
        ),
    )
    return result
