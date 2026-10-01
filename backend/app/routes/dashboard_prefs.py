"""
Customizable Dashboards (spec section 23).

Per-user widget show/hide, order, and compact/comfortable layout,
persisted so it survives logout. Widget keys are free-form strings
defined by each role's dashboard (e.g. "todays_appointments",
"patient_queue") — this endpoint doesn't need to know what they mean,
it just stores the user's arrangement.
"""
from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth

bp = Blueprint("dashboard_prefs", __name__, url_prefix="/api/dashboard-preferences")


@bp.get("")
@require_auth()
def get_prefs():
    rows = query(
        "SELECT widget_key, visible, sort_order, layout FROM dashboard_widget_prefs WHERE user_id=%s ORDER BY sort_order",
        (g.user_id,),
    )
    return jsonify(rows)


@bp.put("")
@require_auth()
def save_prefs():
    """Body: { widgets: [{ widget_key, visible, sort_order, layout }, ...] }
    Replaces the full set for this user in one call to avoid partial-update
    ordering bugs when the user drags widgets around."""
    data = request.get_json(force=True) or {}
    widgets = data.get("widgets", [])
    for w in widgets:
        key = w.get("widget_key")
        if not key:
            continue
        execute(
            """INSERT INTO dashboard_widget_prefs (user_id, widget_key, visible, sort_order, layout)
               VALUES (%s,%s,%s,%s,%s)
               ON DUPLICATE KEY UPDATE visible=VALUES(visible), sort_order=VALUES(sort_order), layout=VALUES(layout)""",
            (g.user_id, key, 1 if w.get("visible", True) else 0,
             w.get("sort_order", 0), w.get("layout", "comfortable")),
        )
    return jsonify({"message": "Dashboard preferences saved"})


@bp.delete("")
@require_auth()
def reset_prefs():
    execute("DELETE FROM dashboard_widget_prefs WHERE user_id=%s", (g.user_id,))
    return jsonify({"message": "Dashboard preferences reset to default"})
