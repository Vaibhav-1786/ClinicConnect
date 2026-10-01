from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth

bp = Blueprint("notifications", __name__, url_prefix="/api/notifications")

VALID_CATEGORIES = {
    "appointment", "payment", "prescription", "laboratory",
    "follow_up", "system", "emergency",
}


@bp.get("")
@require_auth()
def list_notifications():
    """Optional query params: category, unread_only=1, include_archived=1."""
    category = request.args.get("category")
    unread_only = request.args.get("unread_only") == "1"
    include_archived = request.args.get("include_archived") == "1"

    sql = "SELECT * FROM notifications WHERE user_id=%s"
    params = [g.user_id]
    if not include_archived:
        sql += " AND archived=0"
    if category:
        sql += " AND category=%s"; params.append(category)
    if unread_only:
        sql += " AND is_read=0"
    sql += " ORDER BY created_at DESC LIMIT 200"
    return jsonify(query(sql, params))


@bp.get("/counts")
@require_auth()
def category_counts():
    """Unread count per category, for the Notification Center's tab badges."""
    rows = query(
        """SELECT category, COUNT(*) AS unread FROM notifications
           WHERE user_id=%s AND is_read=0 AND archived=0
           GROUP BY category""",
        (g.user_id,),
    )
    return jsonify({r["category"]: r["unread"] for r in rows})


@bp.post("/<int:notif_id>/read")
@require_auth()
def mark_read(notif_id):
    execute("UPDATE notifications SET is_read=1 WHERE id=%s AND user_id=%s", (notif_id, g.user_id))
    return jsonify({"message": "Marked read"})


@bp.post("/<int:notif_id>/unread")
@require_auth()
def mark_unread(notif_id):
    execute("UPDATE notifications SET is_read=0 WHERE id=%s AND user_id=%s", (notif_id, g.user_id))
    return jsonify({"message": "Marked unread"})


@bp.post("/<int:notif_id>/archive")
@require_auth()
def archive_notification(notif_id):
    execute("UPDATE notifications SET archived=1 WHERE id=%s AND user_id=%s", (notif_id, g.user_id))
    return jsonify({"message": "Archived"})


@bp.post("/read-all")
@require_auth()
def mark_all_read():
    category = (request.get_json(silent=True) or {}).get("category")
    if category:
        execute("UPDATE notifications SET is_read=1 WHERE user_id=%s AND category=%s", (g.user_id, category))
    else:
        execute("UPDATE notifications SET is_read=1 WHERE user_id=%s", (g.user_id,))
    return jsonify({"message": "All marked read"})


@bp.get("/preferences")
@require_auth()
def get_preferences():
    rows = query(
        "SELECT category, enabled FROM notification_preferences WHERE user_id=%s",
        (g.user_id,),
    )
    prefs = {c: True for c in VALID_CATEGORIES}
    for r in rows:
        prefs[r["category"]] = bool(r["enabled"])
    return jsonify(prefs)


@bp.put("/preferences")
@require_auth()
def update_preferences():
    data = request.get_json(force=True) or {}
    for category, enabled in data.items():
        if category not in VALID_CATEGORIES:
            continue
        execute(
            """INSERT INTO notification_preferences (user_id, category, enabled)
               VALUES (%s,%s,%s)
               ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)""",
            (g.user_id, category, 1 if enabled else 0),
        )
    return jsonify({"message": "Preferences updated"})
