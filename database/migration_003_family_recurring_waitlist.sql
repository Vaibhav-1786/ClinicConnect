-- ============================================================
-- Migration 003: Family/Dependent Profiles, Recurring Appointments,
--                Receptionist Waitlist Management
-- Safe to run on an existing database: uses IF NOT EXISTS / guarded
-- ALTERs so it will not clobber existing data.
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- ---------- 1. Family / Dependent profiles ----------
CREATE TABLE IF NOT EXISTS family_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,                 -- owning patient account (the one who is logged in)
    full_name VARCHAR(150) NOT NULL,
    dob DATE,
    gender ENUM('Male','Female','Other'),
    relationship ENUM('Self','Child','Parent','Grandparent','Spouse','Sibling','Other') NOT NULL DEFAULT 'Other',
    mobile_number VARCHAR(20),
    address VARCHAR(255),
    blood_group VARCHAR(5),
    allergies TEXT,
    emergency_contact VARCHAR(20),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    INDEX idx_family_patient (patient_id)
);

-- Link appointment requests / appointments to a specific family member when
-- the visit is booked "for" a dependent rather than the account holder.
-- NULL family_member_id keeps meaning "booked for myself" for all existing rows.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_requests' AND COLUMN_NAME = 'family_member_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE appointment_requests ADD COLUMN family_member_id INT NULL AFTER patient_id, ADD CONSTRAINT fk_ar_family FOREIGN KEY (family_member_id) REFERENCES family_members(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointments' AND COLUMN_NAME = 'family_member_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE appointments ADD COLUMN family_member_id INT NULL AFTER patient_id, ADD CONSTRAINT fk_appt_family FOREIGN KEY (family_member_id) REFERENCES family_members(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- 2. Recurring appointment plans ----------
CREATE TABLE IF NOT EXISTS recurring_appointment_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    family_member_id INT NULL,
    doctor_id INT NOT NULL,
    clinic_id INT NOT NULL,
    frequency ENUM('WEEKLY','BIWEEKLY','MONTHLY') NOT NULL,
    preferred_time TIME NOT NULL,
    reason VARCHAR(255),
    start_date DATE NOT NULL,
    occurrence_count INT NOT NULL,          -- total number of visits requested
    status ENUM('ACTIVE','PAUSED','CANCELLED','COMPLETED') DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (family_member_id) REFERENCES family_members(id) ON DELETE SET NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    INDEX idx_recurring_patient (patient_id),
    INDEX idx_recurring_doctor (doctor_id, clinic_id)
);

CREATE TABLE IF NOT EXISTS recurring_appointment_occurrences (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plan_id INT NOT NULL,
    occurrence_date DATE NOT NULL,
    occurrence_time TIME NOT NULL,
    status ENUM('SCHEDULED','BOOKED','SKIPPED','FAILED','CANCELLED') DEFAULT 'SCHEDULED',
    appointment_request_id INT NULL,        -- populated once the individual visit is confirmed
    failure_reason VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES recurring_appointment_plans(id) ON DELETE CASCADE,
    FOREIGN KEY (appointment_request_id) REFERENCES appointment_requests(id) ON DELETE SET NULL,
    UNIQUE KEY uq_plan_occurrence (plan_id, occurrence_date),
    INDEX idx_occurrence_date (occurrence_date)
);

-- ---------- 2b. Fix: allow a cancelled/no-show slot to be rebooked ----------
-- The original `uq_slot` unique key on (doctor_id, appointment_date, appointment_time)
-- does not exclude CANCELLED/NO_SHOW rows, so once a slot is cancelled that
-- exact doctor/date/time can never be booked again by anyone — which breaks
-- both waitlist claiming and ordinary re-approval of a request after a
-- cancellation. Replace it with a generated column that is NULL for
-- inactive appointments; MySQL unique indexes treat multiple NULLs as
-- non-conflicting, so only "live" bookings are constrained.
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointments' AND INDEX_NAME = 'uq_slot'
);
SET @sql := IF(@idx_exists > 0, 'ALTER TABLE appointments DROP INDEX uq_slot', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- `appointments.id` is referenced by 12 other tables' foreign keys
-- (consultation_notes, diagnoses, feedback, followups, invoices,
-- lab_orders, opd_queue, patient_messages, prescriptions, soap_notes,
-- video_sessions, vitals). A STORED GENERATED column forces InnoDB to
-- do a full table rebuild (ALGORITHM=COPY), which drags all of those
-- FKs into the operation and can throw error 1215. A plain column
-- maintained by triggers achieves the same "unique among live rows,
-- NULL for cancelled/no-show" behaviour without ever rebuilding the
-- table (ADD COLUMN / ADD INDEX use ALGORITHM=INSTANT/INPLACE here).
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointments' AND COLUMN_NAME = 'active_slot_key'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE appointments ADD COLUMN active_slot_key VARCHAR(60) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill existing rows.
UPDATE appointments
SET active_slot_key = CASE
  WHEN status NOT IN ('CANCELLED','NO_SHOW')
  THEN CONCAT(doctor_id,'-',appointment_date,'-',appointment_time)
  ELSE NULL
END;

SET @idx_exists2 := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointments' AND INDEX_NAME = 'uq_active_slot'
);
SET @sql := IF(@idx_exists2 = 0,
  'ALTER TABLE appointments ADD UNIQUE KEY uq_active_slot (active_slot_key)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Keep active_slot_key in sync going forward.
DROP TRIGGER IF EXISTS trg_appt_slot_key_insert;
DROP TRIGGER IF EXISTS trg_appt_slot_key_update;

DELIMITER //
CREATE TRIGGER trg_appt_slot_key_insert
BEFORE INSERT ON appointments
FOR EACH ROW
BEGIN
  IF NEW.status NOT IN ('CANCELLED','NO_SHOW') THEN
    SET NEW.active_slot_key = CONCAT(NEW.doctor_id,'-',NEW.appointment_date,'-',NEW.appointment_time);
  ELSE
    SET NEW.active_slot_key = NULL;
  END IF;
END//

CREATE TRIGGER trg_appt_slot_key_update
BEFORE UPDATE ON appointments
FOR EACH ROW
BEGIN
  IF NEW.status NOT IN ('CANCELLED','NO_SHOW') THEN
    SET NEW.active_slot_key = CONCAT(NEW.doctor_id,'-',NEW.appointment_date,'-',NEW.appointment_time);
  ELSE
    SET NEW.active_slot_key = NULL;
  END IF;
END//
DELIMITER ;

-- ---------- 3. Receptionist waitlist ----------
CREATE TABLE IF NOT EXISTS appointment_waitlist (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    family_member_id INT NULL,
    doctor_id INT NOT NULL,
    clinic_id INT NOT NULL,
    preferred_date DATE NOT NULL,
    preferred_time_start TIME NOT NULL,
    preferred_time_end TIME NOT NULL,
    appointment_type VARCHAR(50) DEFAULT 'General',
    reason VARCHAR(255),
    status ENUM('WAITING','NOTIFIED','BOOKED','CANCELLED','EXPIRED') DEFAULT 'WAITING',
    notified_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (family_member_id) REFERENCES family_members(id) ON DELETE SET NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    INDEX idx_waitlist_lookup (doctor_id, clinic_id, preferred_date, status)
);