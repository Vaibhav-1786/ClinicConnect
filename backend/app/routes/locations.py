from flask import Blueprint, request, jsonify

from app.utils.db import query

bp = Blueprint("locations", __name__, url_prefix="/api/locations")


@bp.get("/states")
def states():
    return jsonify(query("SELECT id, name FROM states ORDER BY name"))


@bp.get("/cities")
def cities():
    state_id = request.args.get("state_id")
    if not state_id:
        return jsonify({"error": "state_id is required"}), 400
    return jsonify(query("SELECT id, name FROM cities WHERE state_id=%s ORDER BY name", (state_id,)))


@bp.get("/cities/all")
def all_cities():
    """Flat city list (with state name) for pickers that don't want the
    progressive state -> city drill-down, e.g. the patient login form."""
    return jsonify(query(
        """SELECT c.id, c.name, c.state_id, s.name AS state_name
           FROM cities c JOIN states s ON s.id = c.state_id
           ORDER BY s.name, c.name"""
    ))


@bp.get("/areas")
def areas():
    city_id = request.args.get("city_id")
    if not city_id:
        return jsonify({"error": "city_id is required"}), 400
    return jsonify(query("SELECT id, name FROM areas WHERE city_id=%s ORDER BY name", (city_id,)))
