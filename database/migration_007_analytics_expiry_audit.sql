-- ============================================================
-- Migration 007: Admin Analytics, Doctor Performance, Document
--                Expiry Alerts, Audit Log Viewer support
-- Idempotent: safe to re-run on an existing database.
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- ---------- Audit log filtering ----------
-- The pre-existing audit_logs table had no way to filter by module or
-- organization. Rather than retrofit dozens of call sites, `module` is
-- derived automatically inside app.utils.helpers.add_audit() from the
-- action name, and `clinic_id` is auto-filled from the request's session
-- context when available. Both are nullable so historical rows are
-- unaffected (they just won't have a module/org, which is expected).
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'module'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE audit_logs ADD COLUMN module VARCHAR(50) NULL AFTER action, ADD COLUMN clinic_id INT NULL AFTER module',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_filters'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX idx_audit_filters ON audit_logs (role, module, created_at)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- Document expiry ----------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'doctor_documents' AND COLUMN_NAME = 'issue_date'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE doctor_documents ADD COLUMN issue_date DATE NULL, ADD COLUMN expiry_date DATE NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- Consultation duration (for doctor performance analytics) ----------
-- opd_queue already tracks check_in_time and status; add the two timestamps
-- needed to compute a genuine average consultation duration instead of
-- fabricating one. Populated automatically by the existing status-change
-- endpoint when a token moves to 'In Consultation' / 'Completed'.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opd_queue' AND COLUMN_NAME = 'consultation_started_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE opd_queue ADD COLUMN consultation_started_at TIMESTAMP NULL, ADD COLUMN consultation_completed_at TIMESTAMP NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
