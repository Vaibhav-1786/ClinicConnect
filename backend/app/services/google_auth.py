"""
Server-side verification of Google "Sign in with Google" credentials.

The frontend NEVER tells us who the user is — it only forwards the opaque
ID token (JWT) that Google's Identity Services library handed it after the
patient authenticated. We verify that token's signature and audience here,
against Google's own public keys, before trusting anything inside it.
"""

from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from config import Config


class GoogleTokenError(Exception):
    pass


def verify_google_credential(credential: str) -> dict:
    """
    Verify a Google ID token and return the verified claims.

    Raises GoogleTokenError with a user-safe message on any failure
    (expired token, wrong audience, tampered signature, etc.).
    """
    if not credential:
        raise GoogleTokenError("Missing Google credential")

    if not Config.GOOGLE_CLIENT_ID:
        raise GoogleTokenError("Google Sign-In is not configured on this server")

    try:
        claims = google_id_token.verify_oauth2_token(
            credential, google_requests.Request(), Config.GOOGLE_CLIENT_ID
        )
    except ValueError:
        # Covers: bad signature, expired token, wrong audience/issuer, malformed JWT
        raise GoogleTokenError("Invalid or expired Google credential")

    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise GoogleTokenError("Invalid Google credential issuer")

    if not claims.get("email_verified", False):
        raise GoogleTokenError("Google account email is not verified")

    return {
        "google_id": claims["sub"],
        "email": claims["email"],
        "full_name": claims.get("name") or claims.get("email").split("@")[0],
    }
