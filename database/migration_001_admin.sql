-- ============================================================
-- Migration 001: Admin Panel, Verification & Multi-Org Login
-- Safe / additive: only ADDs columns & tables. Nothing is dropped
-- or renamed, so all existing features keep working unchanged.
-- Run this once, after schema.sql, on an existing database:
--   mysql -u root -p clinic_management < database/migration_001_admin.sql
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- ---------- Sequential, collision-free ID generator ----------
-- Used for DOC-000001 / CLN-000001 / HOS-000001 / REC-000001 style codes.
CREATE TABLE IF NOT EXISTS id_counters (
    counter_key VARCHAR(30) PRIMARY KEY,
    next_value INT NOT NULL DEFAULT 1
);
INSERT INTO id_counters (counter_key, next_value) VALUES
    ('DOC', 1), ('CLN', 1), ('HOS', 1), ('REC', 1)
ON DUPLICATE KEY UPDATE counter_key = counter_key;

-- ---------- Clinics / Hospitals: richer profile + approval ----------
ALTER TABLE clinics
    ADD COLUMN clinic_code VARCHAR(20) NULL UNIQUE AFTER id,
    ADD COLUMN org_type ENUM('clinic','hospital','diagnostic_center','multi_speciality_hospital','other') NOT NULL DEFAULT 'clinic' AFTER type,
    ADD COLUMN pincode VARCHAR(12) NULL AFTER address,
    ADD COLUMN map_location VARCHAR(255) NULL AFTER pincode,
    ADD COLUMN emergency_contact VARCHAR(20) NULL AFTER contact_number,
    ADD COLUMN website VARCHAR(255) NULL AFTER email,
    ADD COLUMN working_days VARCHAR(100) NULL DEFAULT 'Mon-Sat' AFTER closing_time,
    ADD COLUMN emergency_service TINYINT(1) NOT NULL DEFAULT 0 AFTER working_days,
    ADD COLUMN consultation_rooms INT NULL AFTER emergency_service,
    ADD COLUMN beds INT NULL AFTER consultation_rooms,
    ADD COLUMN facilities TEXT NULL AFTER beds,
    ADD COLUMN about TEXT NULL AFTER facilities,
    ADD COLUMN approval_status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'APPROVED' AFTER status,
    ADD COLUMN created_by_admin_id INT NULL AFTER approval_status,
    ADD COLUMN approved_at TIMESTAMP NULL AFTER created_by_admin_id,
    ADD COLUMN rejection_reason VARCHAR(255) NULL AFTER approved_at;

-- Backfill clinic_code for any pre-existing rows so the column can be relied on everywhere.
UPDATE clinics SET clinic_code = CONCAT('CLN-', LPAD(id, 6, '0')) WHERE clinic_code IS NULL;

-- ---------- Doctors: verification / approval / active flag ----------
ALTER TABLE doctors
    ADD COLUMN first_name VARCHAR(80) NULL AFTER full_name,
    ADD COLUMN middle_name VARCHAR(80) NULL AFTER first_name,
    ADD COLUMN last_name VARCHAR(80) NULL AFTER middle_name,
    ADD COLUMN dob DATE NULL AFTER last_name,
    ADD COLUMN gender ENUM('Male','Female','Other') NULL AFTER dob,
    ADD COLUMN mobile VARCHAR(20) NULL AFTER gender,
    ADD COLUMN address VARCHAR(255) NULL AFTER mobile,
    ADD COLUMN state_id INT NULL AFTER address,
    ADD COLUMN city_id INT NULL AFTER state_id,
    ADD COLUMN area_id INT NULL AFTER city_id,
    ADD COLUMN university VARCHAR(200) NULL AFTER qualification,
    ADD COLUMN registration_number VARCHAR(100) NULL AFTER university,
    ADD COLUMN registration_authority VARCHAR(150) NULL AFTER registration_number,
    ADD COLUMN registration_year YEAR NULL AFTER registration_authority,
    ADD COLUMN languages_known VARCHAR(255) NULL AFTER bio,
    ADD COLUMN verification_status ENUM('PENDING','UNDER_REVIEW','APPROVED','REJECTED') NOT NULL DEFAULT 'APPROVED' AFTER languages_known,
    ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER verification_status,
    ADD COLUMN verification_note VARCHAR(500) NULL AFTER is_active,
    ADD COLUMN rejection_reason VARCHAR(255) NULL AFTER verification_note,
    ADD COLUMN created_by_admin_id INT NULL AFTER rejection_reason,
    ADD COLUMN approved_at TIMESTAMP NULL AFTER created_by_admin_id;

-- doctor_code already exists & is UNIQUE; backfill sequential-looking codes only if missing/blank.
UPDATE doctors SET doctor_code = CONCAT('DOC-', LPAD(id, 6, '0'))
  WHERE doctor_code IS NULL OR doctor_code = '';

-- ---------- Doctor verification documents ----------
CREATE TABLE IF NOT EXISTS doctor_documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NULL,
    application_id INT NULL,
    doc_type ENUM('degree_certificate','medical_registration_certificate','identity_proof','additional_certificate','profile_photo') NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    original_name VARCHAR(255),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

-- ---------- Doctor <-> Clinic/Hospital relationship: status per-org ----------
ALTER TABLE clinic_doctors
    ADD COLUMN status ENUM('active','inactive') NOT NULL DEFAULT 'active' AFTER doctor_id,
    ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER status;

-- ---------- Receptionists: code, active flag, which doctor added them ----------
ALTER TABLE receptionists
    ADD COLUMN receptionist_code VARCHAR(20) NULL UNIQUE AFTER user_id,
    ADD COLUMN added_by_doctor_id INT NULL AFTER clinic_id,
    ADD COLUMN mobile VARCHAR(20) NULL AFTER added_by_doctor_id,
    ADD COLUMN address VARCHAR(255) NULL AFTER mobile,
    ADD COLUMN gender ENUM('Male','Female','Other') NULL AFTER address,
    ADD COLUMN dob DATE NULL AFTER gender,
    ADD COLUMN joining_date DATE NULL AFTER dob,
    ADD COLUMN emergency_contact VARCHAR(20) NULL AFTER joining_date,
    ADD COLUMN photo_path VARCHAR(255) NULL AFTER emergency_contact,
    ADD COLUMN notes VARCHAR(500) NULL AFTER photo_path,
    ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER notes;

UPDATE receptionists SET receptionist_code = CONCAT('REC-', LPAD(id, 6, '0'))
  WHERE receptionist_code IS NULL OR receptionist_code = '';

-- ---------- Doctor + Clinic/Hospital combined application (pre-approval staging) ----------
CREATE TABLE IF NOT EXISTS doctor_applications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    status ENUM('PENDING','UNDER_REVIEW','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',

    -- Doctor info
    full_name VARCHAR(150) NOT NULL,
    first_name VARCHAR(80), middle_name VARCHAR(80), last_name VARCHAR(80),
    dob DATE, gender ENUM('Male','Female','Other'),
    mobile VARCHAR(20), email VARCHAR(150),
    address VARCHAR(255), state_id INT, city_id INT, area_id INT,
    photo_path VARCHAR(255),

    specialization VARCHAR(150), qualification VARCHAR(150), university VARCHAR(200),
    registration_number VARCHAR(100), registration_authority VARCHAR(150), registration_year YEAR,
    experience_years INT DEFAULT 0, consultation_fee DECIMAL(10,2) DEFAULT 0,
    appointment_duration_minutes INT DEFAULT 15, bio TEXT, languages_known VARCHAR(255),

    -- Clinic/hospital info: either link to an EXISTING clinic, or create a new one on approval
    existing_clinic_id INT NULL,
    clinic_name VARCHAR(200), org_type ENUM('clinic','hospital','diagnostic_center','multi_speciality_hospital','other'),
    clinic_state_id INT, clinic_city_id INT, clinic_area_id INT,
    clinic_address VARCHAR(255), clinic_pincode VARCHAR(12), map_location VARCHAR(255),
    clinic_phone VARCHAR(20), clinic_email VARCHAR(150), clinic_emergency_contact VARCHAR(20), clinic_website VARCHAR(255),
    opening_time TIME, closing_time TIME, working_days VARCHAR(100), emergency_service TINYINT(1) DEFAULT 0,
    consultation_rooms INT, beds INT, facilities TEXT, about TEXT,

    admin_note VARCHAR(500),
    rejection_reason VARCHAR(255),
    created_by_admin_id INT,
    reviewed_by_admin_id INT,
    reviewed_at TIMESTAMP NULL,

    -- Filled in once approved
    resulting_doctor_id INT NULL,
    resulting_clinic_id INT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (existing_clinic_id) REFERENCES clinics(id),
    FOREIGN KEY (resulting_doctor_id) REFERENCES doctors(id),
    FOREIGN KEY (resulting_clinic_id) REFERENCES clinics(id),
    INDEX idx_app_status (status)
);

-- Point doctor_documents.application_id at the staging table (added after table exists).
ALTER TABLE doctor_documents
    ADD CONSTRAINT fk_doc_documents_application
    FOREIGN KEY (application_id) REFERENCES doctor_applications(id) ON DELETE CASCADE;

-- ---------- Admin account ----------
-- Password hashes must be generated by werkzeug, not written by hand in SQL.
-- After running this migration, run:  python backend/seed_demo.py
-- It creates/repairs an admin@demo.com account with password Admin@123.