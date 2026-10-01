from flask import Blueprint, jsonify

from app.services import qr_profile

bp = Blueprint("public_profiles", __name__, url_prefix="/api/public")


@bp.get("/doctor-profile/<public_token>")
def public_doctor_profile(public_token):
    """No auth required — this is the page a visiting-card/poster QR code
    opens. Only ever returns the safe, pre-filtered field set defined in
    app.services.qr_profile.get_doctor_by_public_token (no internal IDs,
    no address/mobile, no verification-note/rejection-reason)."""
    profile = qr_profile.get_doctor_by_public_token(public_token)
    if not profile:
        return jsonify({"error": "Profile not found"}), 404
    return jsonify(profile)
