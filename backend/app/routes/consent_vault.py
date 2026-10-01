import datetime

from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import add_audit

bp = Blueprint("consent_vault", __name__, url_prefix="/api/consent-vault")

VALID_TYPES = {"consent_form", "insurance", "id_proof", "other"}


@bp.get("")
@require_auth(["patient"])
def list_documents():
    return jsonify(query(
        "SELECT * FROM consent_documents WHERE patient_id=%s ORDER BY created_at DESC", (g.profile_id,),
    ))


@bp.post("")
@require_auth(["patient"])
def create_document():
    data = request.get_json(force=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Title is required"}), 400
    doc_type = data.get("doc_type", "other")
    if doc_type not in VALID_TYPES:
        return jsonify({"error": f"doc_type must be one of {', '.join(sorted(VALID_TYPES))}"}), 400

    doc_id = execute(
        "INSERT INTO consent_documents (patient_id, doc_type, title, notes) VALUES (%s,%s,%s,%s)",
        (g.profile_id, doc_type, title, data.get("notes", "")),
    )
    add_audit(g.user_id, "patient", "CONSENT_DOC_ADDED", f"#{doc_id} {title}")
    return jsonify(query("SELECT * FROM consent_documents WHERE id=%s", (doc_id,), fetchone=True)), 201


@bp.post("/<int:doc_id>/sign")
@require_auth(["patient"])
def sign_document(doc_id):
    doc = query("SELECT * FROM consent_documents WHERE id=%s AND patient_id=%s", (doc_id, g.profile_id), fetchone=True)
    if not doc:
        return jsonify({"error": "Not found"}), 404
    data = request.get_json(force=True) or {}
    signature_name = (data.get("signature_name") or "").strip()
    if not signature_name:
        return jsonify({"error": "Type your full name to sign"}), 400
    execute(
        "UPDATE consent_documents SET is_signed=1, signature_name=%s, signed_at=%s WHERE id=%s",
        (signature_name, datetime.datetime.utcnow(), doc_id),
    )
    add_audit(g.user_id, "patient", "CONSENT_DOC_SIGNED", f"#{doc_id}")
    return jsonify(query("SELECT * FROM consent_documents WHERE id=%s", (doc_id,), fetchone=True))


@bp.delete("/<int:doc_id>")
@require_auth(["patient"])
def delete_document(doc_id):
    doc = query("SELECT * FROM consent_documents WHERE id=%s AND patient_id=%s", (doc_id, g.profile_id), fetchone=True)
    if not doc:
        return jsonify({"error": "Not found"}), 404
    execute("DELETE FROM consent_documents WHERE id=%s", (doc_id,))
    return jsonify({"message": "Document deleted"})
