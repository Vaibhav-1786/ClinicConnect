# Security Policy

ClinicConnect handles sensitive health-related data (patient records, prescriptions, vitals, insurance details). Security reports are taken seriously.

## Supported versions

Only the latest commit on the `main` branch receives security fixes.

| Version | Supported |
|---|---|
| `main` (latest) | Yes |
| Older commits / forks | No |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

1. Use GitHub's private reporting: **Security → Report a vulnerability** on this repository (preferred), or
2. Email the maintainer, Vaibhav Chauhan, at "vaibhavchauhan1786@gmail.com".

Please include:
- A description of the issue and its impact
- Steps to reproduce (affected endpoint/page, role used, request/response if possible)
- Any suggested fix

You can expect an acknowledgement within **7 days** and a status update within **14 days**. Please allow reasonable time for a fix before any public disclosure. Good-faith research will not be met with legal action.

### In scope
Authentication/2FA bypass, broken access control between roles (patient / receptionist / doctor / admin) or between clinics, IDOR on patient records or uploaded documents, injection, JWT or session flaws, secrets exposure, insecure file upload/download.

### Out of scope
Findings that require a default/dev configuration left in place in production (see below), denial of service via volume, missing rate limiting on its own, social engineering, and issues in third-party services (Google, OpenRouter, SMTP providers).

## Security measures in the project

- Passwords hashed with Werkzeug (PBKDF2); never stored in plain text.
- JWT authentication with server-side role checks on protected routes; tokens issued before a password reset/change are rejected.
- Optional OTP-based two-factor authentication on all roles (OTP hashed at rest, 5 attempts, 5-minute expiry, single use), applied to Google Sign-In as well.
- Account-recovery endpoints return generic responses to prevent account enumeration.
- Access control scoped by clinic/patient/appointment (e.g. a doctor can only open history for patients they have treated; video consultation rooms are limited to the two people on the appointment).
- Double-booking prevented with row locks plus a database-level unique key.
- File uploads are extension-restricted, renamed, and served only through authorised API routes.
- Audit log (admin-only, read-only).
- CORS restricted to `CORS_ORIGIN`.

## Deployment checklist (important)

The repository ships with **development defaults**. Before exposing it to real users:

- [ ] Set a long random `JWT_SECRET` (the code falls back to `dev-secret-change-me` if unset).
- [ ] Set `FLASK_ENV=production` so reset tokens, OTPs and IDs are never returned in API responses.
- [ ] **Do not run `python run.py` in production** — it starts Flask with `debug=True` on `0.0.0.0`. Use a production WSGI server (e.g. gunicorn/waitress) behind HTTPS.
- [ ] Serve everything over HTTPS and set `CORS_ORIGIN` / `FRONTEND_URL` to your real domain.
- [ ] Configure `SMTP_*` so recovery emails and OTPs are delivered by email instead of dev mode.
- [ ] Remove or change demo accounts created by `seed_demo.py` (`admin@demo.com`, etc.) and their passwords.
- [ ] Use a dedicated MySQL user with least privilege; never run as `root` with an empty password.
- [ ] Keep the `uploads/` directory outside the web root with restricted permissions and back it up.
- [ ] Add rate limiting (reverse proxy or a Flask extension) on login, OTP and recovery endpoints — none is built in.
- [ ] Keep `.env` out of version control; never commit API keys (`OPENROUTER_API_KEY`, SMTP password).
- [ ] Review local health-data regulations (e.g. India's DPDP Act 2023) before storing real patient data.

## Known limitations

- The login token is kept in the browser's `sessionStorage`, so it is readable by any script on the page; a strict Content-Security-Policy is recommended in production.
- JWTs are stateless: logging out clears the token client-side, and server-side invalidation currently happens only on password change/reset.
- Video consultation uses STUN only (no TURN relay) and HTTP long-poll signalling.
- No automated test suite yet; security regressions must be caught by manual testing.
- The AI assistant sends user messages to a third-party provider (OpenRouter). Do not enable it if patient data must stay on your own infrastructure.
