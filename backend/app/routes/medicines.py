from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit

bp = Blueprint("medicines", __name__, url_prefix="/api/medicines")


@bp.get("")
@require_auth(["doctor", "receptionist"])
def list_medicines():
    search = request.args.get("search")
    category = request.args.get("category")
    sql = "SELECT * FROM medicines WHERE 1=1"
    params = []
    if search:
        sql += " AND name LIKE %s"; params.append(f"%{search}%")
    if category:
        sql += " AND category=%s"; params.append(category)
    sql += " ORDER BY name"
    meds = query(sql, params)
    for m in meds:
        m["low_stock"] = m["stock"] < 20
    return jsonify(meds)


@bp.post("")
@require_auth(["receptionist"])
def add_medicine():
    data = request.get_json(force=True) or {}
    required = ["name", "price", "stock"]
    if any(f not in data for f in required):
        return jsonify({"error": "Missing fields"}), 400
    new_id = execute(
        """INSERT INTO medicines (name, category, price, stock, expiry_date, supplier)
           VALUES (%s,%s,%s,%s,%s,%s)""",
        (data["name"], data.get("category"), data["price"], data["stock"],
         data.get("expiry_date"), data.get("supplier")),
    )
    add_audit(g.user_id, g.role, "MEDICINE_ADDED", data["name"])
    return jsonify({"id": new_id}), 201


@bp.put("/<int:medicine_id>")
@require_auth(["receptionist"])
def update_medicine(medicine_id):
    data = request.get_json(force=True) or {}
    fields, params = [], []
    for f in ["name", "category", "price", "stock", "expiry_date", "supplier"]:
        if f in data:
            fields.append(f"{f}=%s"); params.append(data[f])
    if not fields:
        return jsonify({"error": "No fields to update"}), 400
    params.append(medicine_id)
    execute(f"UPDATE medicines SET {', '.join(fields)} WHERE id=%s", params)
    add_audit(g.user_id, g.role, "MEDICINE_UPDATED", str(medicine_id))
    return jsonify({"message": "Updated"})


@bp.delete("/<int:medicine_id>")
@require_auth(["receptionist"])
def delete_medicine(medicine_id):
    execute("DELETE FROM medicines WHERE id=%s", (medicine_id,))
    add_audit(g.user_id, g.role, "MEDICINE_DELETED", str(medicine_id))
    return jsonify({"message": "Deleted"})


@bp.get("/alerts")
@require_auth(["receptionist", "doctor"])
def stock_alerts():
    low_stock = query("SELECT * FROM medicines WHERE stock < 20 ORDER BY stock")
    expiring = query("SELECT * FROM medicines WHERE expiry_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY) ORDER BY expiry_date")
    return jsonify({"low_stock": low_stock, "expiring_soon": expiring})


def check_allergy_conflicts(patient_id, medicine_ids):
    """Decision-support only: compares the patient's free-text allergies
    field against each medicine's name and allergen_tags using simple
    keyword matching. This never blocks a prescription and never modifies
    it — it only returns warnings for the doctor to review, per the
    Medication Safety Layer requirement that clinical judgment stays with
    the doctor."""
    if not medicine_ids:
        return []
    patient = query("SELECT allergies FROM patients WHERE id=%s", (patient_id,), fetchone=True)
    allergy_text = (patient or {}).get("allergies") or ""
    if not allergy_text.strip():
        return []

    # Split on common separators; ignore very short/noisy tokens.
    import re
    tokens = [tok.strip().lower() for tok in re.split(r"[,;/\n]+", allergy_text) if len(tok.strip()) >= 3]
    if not tokens:
        return []

    placeholders = ",".join(["%s"] * len(medicine_ids))
    meds = query(
        f"SELECT id, name, allergen_tags FROM medicines WHERE id IN ({placeholders})",
        list(medicine_ids),
    )
    warnings = []
    for med in meds:
        haystack = f"{med['name']} {med.get('allergen_tags') or ''}".lower()
        for tok in tokens:
            if tok in haystack:
                warnings.append({
                    "medicine_id": med["id"], "medicine_name": med["name"],
                    "allergy": tok, "note": "Matches a substance in the patient's recorded allergies",
                })
                break
    return warnings


def check_interactions(medicine_ids):
    """Return list of interaction warnings among the given medicine ids."""
    if len(medicine_ids) < 2:
        return []
    warnings = []
    ids = list(medicine_ids)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            hit = query(
                """SELECT di.*, ma.name AS med_a_name, mb.name AS med_b_name FROM drug_interactions di
                   JOIN medicines ma ON ma.id = di.medicine_a_id
                   JOIN medicines mb ON mb.id = di.medicine_b_id
                   WHERE (medicine_a_id=%s AND medicine_b_id=%s) OR (medicine_a_id=%s AND medicine_b_id=%s)""",
                (a, b, b, a), fetchone=True,
            )
            if hit:
                warnings.append({
                    "medicine_a": hit["med_a_name"], "medicine_b": hit["med_b_name"],
                    "severity": hit["severity"], "description": hit["description"],
                })
    return warnings
