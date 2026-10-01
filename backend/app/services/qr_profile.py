"""QR Code Doctor Profile (spec feature #11). The QR/URL always encodes an
opaque, random public_token — never the internal doctor_id — so it can be
printed on visiting cards / posters without exposing database internals."""
import secrets

from config import Config
from app.utils.db import query, execute


def _new_token():
    return secrets.token_urlsafe(24)


def get_or_create_profile(doctor_id):
    existing = query(
        "SELECT * FROM doctor_qr_profiles WHERE doctor_id=%s", (doctor_id,), fetchone=True
    )
    if existing:
        return existing
    token = _new_token()
    row_id = execute(
        "INSERT INTO doctor_qr_profiles (doctor_id, public_token) VALUES (%s,%s)",
        (doctor_id, token),
    )
    return query("SELECT * FROM doctor_qr_profiles WHERE id=%s", (row_id,), fetchone=True)


def regenerate_token(doctor_id):
    profile = get_or_create_profile(doctor_id)
    token = _new_token()
    execute(
        "UPDATE doctor_qr_profiles SET public_token=%s, regenerated_count=regenerated_count+1 WHERE id=%s",
        (token, profile["id"]),
    )
    return query("SELECT * FROM doctor_qr_profiles WHERE id=%s", (profile["id"],), fetchone=True)


def public_profile_url(public_token):
    return f"{Config.FRONTEND_URL}/doctor-profile/{public_token}"


def get_doctor_by_public_token(public_token):
    """Only the fields safe to show on a public profile page — no internal
    IDs, no verification-note/rejection-reason, no address/mobile."""
    profile = query(
        "SELECT * FROM doctor_qr_profiles WHERE public_token=%s AND is_active=1",
        (public_token,), fetchone=True,
    )
    if not profile:
        return None
    doctor = query(
        """SELECT full_name, specialization, qualification, experience_years, bio,
                  photo_path, verification_status, consultation_fee
           FROM doctors WHERE id=%s AND is_active=1""",
        (profile["doctor_id"],), fetchone=True,
    )
    if not doctor:
        return None
    clinics = query(
        """SELECT c.name, c.org_type, c.address FROM clinic_doctors cd
           JOIN clinics c ON c.id = cd.clinic_id
           WHERE cd.doctor_id=%s AND cd.status='active' AND c.approval_status='APPROVED'""",
        (profile["doctor_id"],),
    )
    doctor["is_verified"] = doctor.pop("verification_status") == "APPROVED"
    doctor["organizations"] = clinics
    return doctor


def generate_qr_svg(data_text):
    """Render an SVG QR code (no raster/Pillow dependency needed)."""
    import qrcode
    import qrcode.image.svg

    factory = qrcode.image.svg.SvgPathImage
    img = qrcode.make(data_text, image_factory=factory, box_size=10, border=2)
    from io import BytesIO
    buf = BytesIO()
    img.save(buf)
    return buf.getvalue().decode("utf-8")
