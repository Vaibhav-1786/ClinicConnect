"""
Minimal SMTP mailer. Uses only Python's built-in smtplib/email modules — no
paid API, no third-party SDK. Works with any SMTP provider; Gmail's free
SMTP relay (smtp.gmail.com:587 + an App Password) is the easiest zero-cost
option for a small clinic app. See .env.example for setup notes.

If SMTP_HOST is not configured, send_email() silently no-ops and returns
False so callers (e.g. forgot-password) can fall back to dev-mode behavior
instead of crashing when no mail server is set up yet.
"""
import smtplib
import ssl
from email.message import EmailMessage

from config import Config


def is_configured():
    return bool(Config.SMTP_HOST and Config.SMTP_USER and Config.SMTP_PASSWORD)


def send_email(to_email, subject, html_body, text_body=None):
    if not is_configured():
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = Config.SMTP_USER
    msg["To"] = to_email
    msg.set_content(text_body or "Please view this email in an HTML-capable client.")
    msg.add_alternative(html_body, subtype="html")

    context = ssl.create_default_context()
    with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT, timeout=10) as server:
        server.starttls(context=context)
        server.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
        server.send_message(msg)
    return True


def _wrap_email(heading, body_html):
    return f"""
    <div style="font-family: Segoe UI, Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #2563eb;">ClinicConnect</h2>
      {body_html}
      <p style="font-size:13px;color:#64748b;margin-top:20px;">If you didn't request this, you can safely ignore
         this email — no changes have been made to your account.</p>
    </div>
    """


def send_password_reset_email(to_email, user_name, reset_link):
    subject = "Reset your ClinicConnect password"
    html_body = _wrap_email("Reset your password", f"""
      <p>Hi {user_name or ''},</p>
      <p>We received a request to reset your password. Click the button below to choose a new one.
         This link expires in 1 hour and can only be used once.</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="{reset_link}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          Reset Password
        </a>
      </p>
      <p style="font-size:13px;color:#64748b;">Or copy this link into your browser:<br>{reset_link}</p>
    """)
    text_body = (
        f"Hi {user_name or ''},\n\n"
        f"We received a request to reset your password. Open this link to choose a new one "
        f"(expires in 1 hour, single use):\n{reset_link}\n\n"
        f"If you didn't request this, you can ignore this email."
    )
    return send_email(to_email, subject, html_body, text_body)


def send_doctor_id_email(to_email, doctor_name, doctor_code):
    subject = "Your ClinicConnect Doctor ID"
    html_body = _wrap_email("Your Doctor ID", f"""
      <p>Hi {doctor_name or ''},</p>
      <p>You (or someone using your registered email) asked to recover your Doctor ID. Here it is:</p>
      <p style="text-align:center; margin: 24px 0;">
        <span style="background:#eef2ff;color:#2563eb;padding:10px 20px;border-radius:8px;font-weight:700;font-size:18px;letter-spacing:1px;">
          {doctor_code}
        </span>
      </p>
      <p>To sign in, you'll also need the Clinic/Hospital ID of the organization you want to access.
         If you're not sure which one that is, use the "Forgot Clinic/Hospital ID?" link on the Doctor
         Login page.</p>
    """)
    text_body = (
        f"Hi {doctor_name or ''},\n\n"
        f"Your Doctor ID is: {doctor_code}\n\n"
        f"You'll also need the Clinic/Hospital ID of the organization you want to sign in to. "
        f"Use \"Forgot Clinic/Hospital ID?\" on the Doctor Login page if you don't have it handy."
    )
    return send_email(to_email, subject, html_body, text_body)


def send_receptionist_id_email(to_email, receptionist_name, receptionist_code, clinic_name=None):
    subject = "Your ClinicConnect Receptionist ID"
    clinic_line = f"<p>Your account is associated with <strong>{clinic_name}</strong>.</p>" if clinic_name else ""
    html_body = _wrap_email("Your Receptionist ID", f"""
      <p>Hi {receptionist_name or ''},</p>
      <p>You (or someone using your registered email) asked to recover your Receptionist ID. Here it is:</p>
      <p style="text-align:center; margin: 24px 0;">
        <span style="background:#eef2ff;color:#2563eb;padding:10px 20px;border-radius:8px;font-weight:700;font-size:18px;letter-spacing:1px;">
          {receptionist_code}
        </span>
      </p>
      {clinic_line}
      <p>You'll also need your Clinic/Hospital ID to sign in. If you're not sure which one that is, use the
         "Forgot Clinic/Hospital ID?" link on the Receptionist Login page.</p>
    """)
    text_body = (
        f"Hi {receptionist_name or ''},\n\n"
        f"Your Receptionist ID is: {receptionist_code}\n\n"
        f"You'll also need your Clinic/Hospital ID to sign in. Use \"Forgot Clinic/Hospital ID?\" on the "
        f"Receptionist Login page if you don't have it handy."
    )
    return send_email(to_email, subject, html_body, text_body)


def send_clinic_id_email(to_email, user_name, clinics):
    subject = "Your ClinicConnect Clinic/Hospital ID"
    if clinics:
        items = "".join(
            f"<li style='margin-bottom:6px;'><strong>{c['clinic_code']}</strong> — {c['name']}</li>"
            for c in clinics
        )
        list_html = f"<ul style='padding-left:18px;'>{items}</ul>"
        list_text = "\n".join(f"- {c['clinic_code']} — {c['name']}" for c in clinics)
        intro = (
            "Here is the Clinic/Hospital ID (or list of IDs, if you're linked to more than one organization) "
            "associated with your account:"
        )
    else:
        list_html = "<p>We couldn't find any organization currently linked to this account.</p>"
        list_text = "We couldn't find any organization currently linked to this account."
        intro = "You asked to recover your Clinic/Hospital ID."
    html_body = _wrap_email("Your Clinic/Hospital ID", f"""
      <p>Hi {user_name or ''},</p>
      <p>{intro}</p>
      {list_html}
    """)
    text_body = f"Hi {user_name or ''},\n\n{intro}\n\n{list_text}"
    return send_email(to_email, subject, html_body, text_body)
