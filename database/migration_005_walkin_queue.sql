-- ============================================================
-- Migration 005: Walk-in queue support for opd_queue
-- Idempotent: safe to re-run on an existing database.
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- appointment_id must become nullable so a pure walk-in (no pre-booked
-- appointment) can still get a token. FKs stay intact for the appointment
-- case; walk-ins are identified by patient_id or the free-text fields below.
SET @col_nullable := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opd_queue' AND COLUMN_NAME = 'appointment_id'
);
SET @sql := IF(@col_nullable = 'NO',
  'ALTER TABLE opd_queue MODIFY COLUMN appointment_id INT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opd_queue' AND COLUMN_NAME = 'patient_id'
);
SET @sql := IF(@col_exists = 0,
  CONCAT(
    'ALTER TABLE opd_queue ',
    'ADD COLUMN patient_id INT NULL AFTER appointment_id, ',
    'ADD COLUMN walk_in_name VARCHAR(150) NULL AFTER patient_id, ',
    'ADD COLUMN walk_in_phone VARCHAR(20) NULL AFTER walk_in_name, ',
    'ADD COLUMN visit_type ENUM(''APPOINTMENT'',''WALK-IN'') NOT NULL DEFAULT ''APPOINTMENT'' AFTER doctor_id, ',
    'ADD CONSTRAINT fk_opd_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL'
  ),
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill visit_type/patient_id for existing rows (all pre-existing rows are
-- appointment-based check-ins).
UPDATE opd_queue q
JOIN appointments a ON a.id = q.appointment_id
SET q.patient_id = a.patient_id, q.visit_type = 'APPOINTMENT'
WHERE q.appointment_id IS NOT NULL AND q.patient_id IS NULL;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opd_queue' AND INDEX_NAME = 'idx_opd_doctor_date'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_opd_doctor_date ON opd_queue (doctor_id, check_in_time)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
