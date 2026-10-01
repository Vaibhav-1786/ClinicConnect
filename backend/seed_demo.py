"""
Run this AFTER schema.sql + seed.sql + migration_001_admin.sql have been
loaded into MySQL. Creates working demo login accounts (admin / patient /
receptionist / doctor) with properly hashed passwords, plus doctor<->clinic
links and a weekly availability schedule.

Since doctor & receptionist logins now require ID + Clinic/Hospital ID +
Password (not email), this script prints the generated codes at the end —
use those to log in, not the email address.

Usage:
    cd backend
    python seed_demo.py
"""
from app.utils.db import query, execute
from app.utils.auth import hash_password
from app.utils.helpers import gen_code, gen_sequential_code

DEMO_PASSWORD = "Password123"
ADMIN_PASSWORD = "Admin@123"


def get_or_create_user(role, email, phone):
    existing = query("SELECT id FROM users WHERE email=%s", (email,), fetchone=True)
    if existing:
        return existing["id"]
    return execute(
        "INSERT INTO users (role, email, phone, password_hash) VALUES (%s,%s,%s,%s)",
        (role, email, phone, hash_password(DEMO_PASSWORD)),
    )


def main():
    clinic = query("SELECT id, clinic_code FROM clinics ORDER BY id LIMIT 1", fetchone=True)
    clinic2 = query("SELECT id, clinic_code FROM clinics ORDER BY id LIMIT 1 OFFSET 1", fetchone=True)

    # seed.sql doesn't assign clinic_code (that's normally done at
    # clinic-registration time), so backfill it here for any clinic that's
    # missing one — otherwise receptionist/doctor login (which is keyed by
    # clinic_code, not clinic id) has nothing to match against.
    for c in (clinic, clinic2):
        if c and not c.get("clinic_code"):
            new_code = gen_sequential_code("CLN")
            execute("UPDATE clinics SET clinic_code=%s WHERE id=%s", (new_code, c["id"]))
            c["clinic_code"] = new_code

    area = query("SELECT id, city_id FROM areas WHERE name='Satellite'", fetchone=True)
    city_id = area["city_id"]
    state_id = query("SELECT state_id FROM cities WHERE id=%s", (city_id,), fetchone=True)["state_id"]

    # Admin
    admin_user = query("SELECT id FROM users WHERE email=%s AND role='admin'", ("admin@demo.com",), fetchone=True)
    if not admin_user:
        execute(
            "INSERT INTO users (role, email, phone, password_hash) VALUES ('admin', %s, %s, %s)",
            ("admin@demo.com", "9000000000", hash_password(ADMIN_PASSWORD)),
        )
    else:
        execute("UPDATE users SET password_hash=%s WHERE id=%s", (hash_password(ADMIN_PASSWORD), admin_user["id"]))

    # Doctor
    doc_user = get_or_create_user("doctor", "doctor@demo.com", "9000000001")
    doctor = query("SELECT id, doctor_code FROM doctors WHERE user_id=%s", (doc_user,), fetchone=True)
    if not doctor:
        doctor_code = gen_sequential_code("DOC")
        doctor_id = execute(
            """INSERT INTO doctors (user_id, doctor_code, full_name, specialization, qualification,
               experience_years, consultation_fee, appointment_duration_minutes,
               verification_status, is_active)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'APPROVED',1)""",
            (doc_user, doctor_code, "Dr. Anita Shah", "General Physician", "MBBS, MD", 8, 500.00, 15),
        )
    else:
        doctor_id = doctor["id"]
        doctor_code = doctor["doctor_code"]

    for cid in [clinic["id"], clinic2["id"]]:
        link = query("SELECT id FROM clinic_doctors WHERE clinic_id=%s AND doctor_id=%s", (cid, doctor_id), fetchone=True)
        if not link:
            execute("INSERT INTO clinic_doctors (clinic_id, doctor_id) VALUES (%s,%s)", (cid, doctor_id))

    # Weekly availability: Mon-Fri 9-13 and 16-19 at clinic 1
    for dow in range(0, 5):
        exists = query(
            "SELECT id FROM doctor_availability WHERE doctor_id=%s AND clinic_id=%s AND day_of_week=%s",
            (doctor_id, clinic["id"], dow), fetchone=True,
        )
        if not exists:
            execute(
                "INSERT INTO doctor_availability (doctor_id, clinic_id, day_of_week, start_time, end_time) VALUES (%s,%s,%s,'09:00:00','13:00:00')",
                (doctor_id, clinic["id"], dow),
            )
            execute(
                "INSERT INTO doctor_availability (doctor_id, clinic_id, day_of_week, start_time, end_time) VALUES (%s,%s,%s,'16:00:00','19:00:00')",
                (doctor_id, clinic["id"], dow),
            )

    # Receptionist
    rec_user = get_or_create_user("receptionist", "receptionist@demo.com", "9000000002")
    rec = query("SELECT id, receptionist_code FROM receptionists WHERE user_id=%s", (rec_user,), fetchone=True)
    if not rec:
        receptionist_code = gen_sequential_code("REC")
        execute(
            """INSERT INTO receptionists (user_id, receptionist_code, full_name, clinic_id, is_active)
               VALUES (%s,%s,%s,%s,1)""",
            (rec_user, receptionist_code, "Priya Mehta", clinic["id"]),
        )
    else:
        receptionist_code = rec["receptionist_code"]

    # Patient
    pat_user = get_or_create_user("patient", "patient@demo.com", "9000000003")
    pat = query("SELECT id FROM patients WHERE user_id=%s", (pat_user,), fetchone=True)
    if not pat:
        execute(
            """INSERT INTO patients (user_id, patient_code, full_name, dob, gender, address,
               state_id, city_id, area_id, blood_group, allergies, emergency_contact)
               VALUES (%s,%s,%s,'1995-05-10','Female','12 MG Road',%s,%s,%s,'O+','None','9000000009')""",
            (pat_user, gen_code("PAT"), "Riya Patel", state_id, city_id, area["id"]),
        )

    print("Demo accounts ready")
    print(f" Admin:         admin@demo.com / {ADMIN_PASSWORD}")
    print(f" Patient:       patient@demo.com / {DEMO_PASSWORD}")
    print(f" Receptionist:  ID={receptionist_code}  Clinic/Hospital ID={clinic['clinic_code']}  Password={DEMO_PASSWORD}")
    print(f" Doctor:        ID={doctor_code}  Clinic/Hospital ID={clinic['clinic_code']} OR {clinic2['clinic_code']}  Password={DEMO_PASSWORD}")


if __name__ == "__main__":
    main()
