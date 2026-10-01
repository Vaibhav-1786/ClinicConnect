-- ============================================================
-- Migration 018: Shared Receptionist / Doctor Access Scoping
-- — additive, idempotent, backward compatible.
--
--   mysql -u root -p clinic_management < database/migration_018_receptionist_doctor_scope.sql
--
-- Problem: a hospital with 100 doctors should not need 100
-- receptionists. Receptionists already act at clinic scope
-- (see appointments.py: g.clinic_id checks), which already lets
-- one receptionist handle every doctor in their clinic. This
-- migration adds the ability for an admin to NARROW that down
-- for a given receptionist to a department or a hand-picked set
-- of doctors, without touching the existing clinic-wide default.
--
-- Every existing receptionist gets access_type='ALL', which is
-- exactly the behaviour they already had — this migration changes
-- no existing receptionist's effective access.
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- 1. Optional department tag on doctors, for Option B (department-based
--    access). Nullable and unused unless an admin sets it — existing
--    doctor rows are unaffected.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'doctors' AND COLUMN_NAME = 'department'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE doctors ADD COLUMN department VARCHAR(100) NULL AFTER specialization',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. access_type on receptionists. Default 'ALL' preserves today's
--    behaviour (hospital-wide within their own clinic) for every
--    existing row with zero migration of data required.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'receptionists' AND COLUMN_NAME = 'access_type'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE receptionists ADD COLUMN access_type ENUM(''ALL'',''DEPARTMENT'',''SPECIFIC'') NOT NULL DEFAULT ''ALL'' AFTER clinic_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Many-to-many: one receptionist <-> many doctors (Option C).
CREATE TABLE IF NOT EXISTS receptionist_doctor_access (
    id INT AUTO_INCREMENT PRIMARY KEY,
    receptionist_id INT NOT NULL,
    doctor_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_receptionist_doctor (receptionist_id, doctor_id),
    FOREIGN KEY (receptionist_id) REFERENCES receptionists(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

-- 4. One receptionist <-> many departments (Option B).
CREATE TABLE IF NOT EXISTS receptionist_department_access (
    id INT AUTO_INCREMENT PRIMARY KEY,
    receptionist_id INT NOT NULL,
    department VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_receptionist_department (receptionist_id, department),
    FOREIGN KEY (receptionist_id) REFERENCES receptionists(id) ON DELETE CASCADE
);

-- No backfill needed for existing doctor<->receptionist relationships:
-- the old `added_by_doctor_id` column on receptionists was informational
-- (who created the account) and never restricted which doctors a
-- receptionist could manage — clinic_id already did that, hospital-wide.
-- access_type defaulting to 'ALL' keeps that exact behaviour intact.
