import os


def _load_dotenv(path):
    """Load simple KEY=VALUE entries from a local .env file."""
    if not os.path.isfile(path):
        return

    with open(path, encoding="utf-8") as env_file:
        for line in env_file:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


_load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


class Config:
    DB_HOST = os.getenv("DATABASE_HOST", "localhost")
    DB_PORT = int(os.getenv("DATABASE_PORT", 3306))
    DB_NAME = os.getenv("DATABASE_NAME", "clinic_management")
    DB_USER = os.getenv("DATABASE_USER", "root")
    DB_PASSWORD = os.getenv("DATABASE_PASSWORD", "")

    JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
    JWT_EXPIRES_HOURS = int(os.getenv("JWT_EXPIRES_HOURS", 12))

    # Distinguishes local/dev testing (where it's fine to hand back reset
    # tokens/links/OTPs directly in API responses because no SMTP is set up)
    # from production, where that must never happen. Set FLASK_ENV=production
    # in the real deployment's .env.
    FLASK_ENV = os.getenv("FLASK_ENV", "development")
    IS_PRODUCTION = FLASK_ENV.strip().lower() == "production"

    CORS_ORIGIN = os.getenv("CORS_ORIGIN", "http://localhost:5173")
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
    UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", "../uploads")

    SMTP_HOST = os.getenv("SMTP_HOST", "")
    SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")

    # --- AI Assistant (OpenRouter) ---
    OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
    OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
    OPENROUTER_SITE_URL = os.getenv("OPENROUTER_SITE_URL", "http://localhost:5173")
    OPENROUTER_APP_NAME = os.getenv("OPENROUTER_APP_NAME", "ClinicConnect")

    # --- Google Sign-In (patients only) ---
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
