-- ============================================================
-- Migration 004: Insurance, Medicine Reminders, Health Timeline support
-- Idempotent: safe to re-run on an existing database.
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- ---------- 1. Insurance ----------
CREATE TABLE IF NOT EXISTS insurance_profiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    provider VARCHAR(150) NOT NULL,
    policy_number VARCHAR(100) NOT NULL,
    member_id VARCHAR(100),
    valid_from DATE,
    valid_until DATE,
    policy_type ENUM('Individual','Family Floater','Group/Employer','Government Scheme','Other') DEFAULT 'Individual',
    coverage_details TEXT,
    is_primary TINYINT(1) DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    INDEX idx_insurance_patient (patient_id)
);

-- ---------- 2. Medicine reminders ----------
-- Extend prescription_items with the reminder schedule captured at
-- prescribing time. Nullable so existing prescriptions are unaffected.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prescription_items' AND COLUMN_NAME = 'start_date'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE prescription_items ADD COLUMN start_date DATE NULL, ADD COLUMN end_date DATE NULL, ADD COLUMN reminder_times VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS medicine_reminder_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    prescription_item_id INT NOT NULL,
    patient_id INT NOT NULL,
    reminder_date DATE NOT NULL,
    reminder_time TIME NOT NULL,
    status ENUM('PENDING','TAKEN','MISSED','SKIPPED') DEFAULT 'PENDING',
    taken_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prescription_item_id) REFERENCES prescription_items(id) ON DELETE CASCADE,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    UNIQUE KEY uq_reminder_slot (prescription_item_id, reminder_date, reminder_time),
    INDEX idx_reminder_patient_date (patient_id, reminder_date)
);

-- ---------- 3. Health timeline support ----------
-- Vaccinations were never linked to a specific dependent; add the same
-- optional family_member_id used elsewhere so a dependent's vaccination
-- history can be filtered correctly on the timeline.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vaccinations' AND COLUMN_NAME = 'family_member_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE vaccinations ADD COLUMN family_member_id INT NULL AFTER patient_id, ADD CONSTRAINT fk_vacc_family FOREIGN KEY (family_member_id) REFERENCES family_members(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
