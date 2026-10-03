# 🏥ClinicConnect — Clinic & Hospital Management Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![React](https://img.shields.io/badge/Frontend-React%2018%20%2B%20Vite-61dafb)
![Flask](https://img.shields.io/badge/Backend-Flask%203-000000)
![MySQL](https://img.shields.io/badge/Database-MySQL-4479a1)
![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8)

ClinicConnect is a full-stack, role-based clinic and hospital management system built for Indian healthcare workflows. It covers the whole patient journey — finding a clinic, booking, OPD queue, consultation, prescription, billing and follow-up — with four separate portals: **Patient**, **Receptionist**, **Doctor** and **Admin**.

It is available in **English, Hindi and Gujarati** and can be installed as a PWA.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Architecture](#Architecture )
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Demo accounts](#demo-accounts)
- [Quick walkthrough](#quick-walkthrough)
- [API overview](#api-overview)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Patient
- Register / login (email + password, optional **Google Sign-In**)
- Discover clinics by State → City → Area, and find a specialist by concern (rule-based, not a diagnosis)
- Book appointments (in-person or **online video**), for yourself or **family members**
- **Recurring appointments**, **waitlist** with auto-notification and one-click slot claim
- Prescriptions, printable receipts, payments, insurance policies
- **Medicine reminders**, **health timeline**, care checklist, consent vault
- Second-opinion requests, SOS button, voice messages, AI assistant "Clara"

### Receptionist
- Review appointment requests with live slot-conflict checks (approve / reject / reschedule / cancel)
- **Walk-in queue / OPD tokens** (current, next, waiting line)
- Billing: line items, discount, GST, partial payments, insurance view
- Bulk notifications, waitlist management, no-show risk, reminder escalations
- Optional per-receptionist scoping to specific doctors or departments

### Doctor
- Weekly availability, leave dates, multi-clinic membership
- Appointment lifecycle: `CONFIRMED → CHECKED_IN → IN_CONSULTATION → COMPLETED`
- Vitals, diagnosis, prescriptions with **drug-interaction warnings**
- **Voice-to-text notes** and reusable note templates
- **Cross-organization patient history** (only for patients the doctor has treated)
- WebRTC **video consultation**, today's queue, second-opinion inbox

### Admin
- Clinic / doctor onboarding applications with document verification and expiry alerts
- Analytics, forecasting, doctor performance, productivity and healthcare map
- Staff management and fine-grained permissions
- Alert centre and read-only **audit log viewer**
- Admin AI assistant

### Platform
- JWT auth with role checks on the server and in the UI
- Optional **two-factor authentication** (OTP) for every role
- Account recovery: forgot password / doctor ID / receptionist ID / clinic ID
- PWA with offline app shell and read-only offline receptionist queue
- Responsive layout (phone → large monitor), light/dark theme
- Database-enforced double-booking protection

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router, Axios, Recharts, vite-plugin-pwa |
| Backend | Python, Flask 3, Flask-CORS, PyJWT |
| Database | MySQL (schema + 18 idempotent migrations) |
| Integrations | Google Sign-In (ID token), SMTP email, OpenRouter (AI assistant), WebRTC (STUN) |

---

## Project structure

```text
clinic-management/
├── backend/
│   ├── app/
│   │   ├── routes/        # ~50 Flask blueprints (auth, appointments, billing, admin, ...)
│   │   ├── services/      # slots, matching, forecast, risk, alerts, mailer, ...
│   │   └── utils/         # db pool, auth/JWT, permissions, helpers
│   ├── config.py          # reads environment / .env
│   ├── run.py             # dev server entry point
│   ├── seed_demo.py       # creates demo accounts
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/         # patient / receptionist / doctor / admin / auth / shared
│   │   ├── components/    # shared UI (video room, triage, search, recovery, ...)
│   │   ├── context/       # auth, theme, language, toast
│   │   ├── i18n/          # en / hi / gu translations
│   │   └── services/api.js
│   └── vite.config.js
├── database/
│   ├── schema.sql
│   ├── migration_001 ... migration_018 .sql
│   └── seed.sql
├── .env.example
├── RESPONSIVE_CHANGES.md
├── SECURITY.md
└── LICENSE
```
---

## Architecture 

<img width="11144" height="9793" alt="diagram" src="https://github.com/user-attachments/assets/9371337c-8d94-4b56-89bd-f939100229b7" />


---

## Getting started

### Prerequisites
- Python 3.10+
- Node.js 18+ and npm
- MySQL 8+

### 1. Clone

```bash
git clone https://github.com/<your-username>/clinic-management.git
cd clinic-management
```

### 2. Database

```bash
mysql -u root -p < database/schema.sql

# Apply every migration in order (001 → 018). Migrations are idempotent.
for f in database/migration_*.sql; do
  mysql -u root -p clinic_management < "$f"
done

mysql -u root -p < database/seed.sql
```

> On Windows PowerShell, run each `migration_0XX_*.sql` file individually with the same `mysql` command.

### 3. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp ../.env.example ../.env        # edit with your MySQL credentials and a real JWT_SECRET
python seed_demo.py               # creates demo accounts and prints their IDs
python run.py                     # API at http://localhost:5000
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev                       # http://localhost:5173 (proxies /api to :5000)
```

To try the installable PWA / offline features (not active in dev mode):

```bash
npm run build
npm run preview
```

---

## Configuration

Copy `.env.example` to `.env` in the project root.

| Variable | Purpose |
|---|---|
| `DATABASE_HOST` / `PORT` / `NAME` / `USER` / `PASSWORD` | MySQL connection |
| `JWT_SECRET`, `JWT_EXPIRES_HOURS` | Token signing and lifetime — **use a long random secret** |
| `FLASK_ENV` | Set to `production` in real deployments (hides dev-only tokens/OTPs) |
| `CORS_ORIGIN`, `FRONTEND_URL` | Allowed origin and link base for emails |
| `UPLOAD_FOLDER` | Where uploaded documents are stored |
| `SMTP_HOST` / `PORT` / `USER` / `PASSWORD` | Email for recovery and OTP (e.g. Gmail App Password) |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Optional AI assistant |
| `GOOGLE_CLIENT_ID` | Optional Google Sign-In (backend) |

Frontend (`frontend/.env`): `VITE_GOOGLE_CLIENT_ID` — public client ID only, never a secret.

Without SMTP configured and with `FLASK_ENV` not set to `production`, reset links and OTPs are returned in the API response so local development works.

---

## Demo accounts

Created by `python seed_demo.py` (**development only — remove before deploying**):

| Role | Login |
|---|---|
| Admin | `admin@demo.com` / `Admin@123` |
| Patient | `patient@demo.com` / `Password123` |
| Receptionist | ID `REC-000001`, Clinic ID `CLN-000001`, password `Password123` |
| Doctor | ID printed by the script, Clinic ID `CLN-000001` or `CLN-000002`, password `Password123` |

---

## Quick walkthrough

1. Log in as the patient → **Find Clinic/Hospital** → choose a doctor, date and slot → submit.
2. Log in as the receptionist → **Appointment Requests** → **Review** → **Approve**.
3. Log in as the doctor → open the appointment → check in → record vitals → diagnosis → prescription → **Completed**.
4. As the receptionist → **Billing** → generate an invoice and record a payment.
5. As the patient → **Payments** → print the receipt, then leave feedback.

---

## API overview

All protected endpoints require `Authorization: Bearer <jwt>` and return JSON, with `{"error": "..."}` on failure.

| Area | Base path |
|---|---|
| Auth, 2FA, recovery, language | `/api/auth/*` |
| Locations, clinics, doctors, availability | `/api/locations`, `/api/clinics`, `/api/doctors` |
| Appointments, recurring, waitlist, family | `/api/appointments`, `/api/patient/*` |
| Prescriptions, medicines, vitals, notes | `/api/prescriptions`, `/api/medicines`, `/api/vitals`, `/api/doctor/*` |
| Billing and insurance | `/api/invoices`, `/api/payments`, `/api/patient/insurance` |
| Queue, bulk notifications, search | `/api/opd`, `/api/receptionist/*`, `/api/search` |
| Video consultation | `/api/video/*` |
| Admin, analytics, staff, permissions | `/api/admin/*` |
| AI assistant | `/api/ai`, `/api/admin/ai` |
| Health check | `GET /api/health` |

Browse `backend/app/routes/` for the full list of endpoints.

---

## Security

Role-based access control, hashed passwords, optional 2FA, session invalidation on password change, scoped data access and audit logging are built in. This repository ships with development defaults — read **[SECURITY.md](SECURITY.md)** for the production checklist and how to report vulnerabilities.

---

## Known limitations

- No automated test suite yet.
- Video calls use STUN only (no TURN) and HTTP long-poll signalling.
- Only navigation, login and dashboards are fully translated to Hindi/Gujarati; other pages fall back to English.
- No built-in rate limiting.

---

## Contributing

Issues and pull requests are welcome. Please open an issue first for larger changes, keep migrations additive and idempotent, and never commit secrets or real patient data.

---

## License

Released under the [MIT License](LICENSE) © 2026 Vaibhav Chauhan.

> **Disclaimer:** ClinicConnect is software for managing clinic operations. It does not provide medical advice or diagnosis, and its specialist routing and AI assistant are navigation aids only.
