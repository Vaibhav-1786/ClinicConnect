-- ============================================================
-- Migration 017: Manual (free-text) medicine names on prescriptions.
-- Doctors can now type any medicine name instead of picking from the
-- limited `medicines` table. Additive, idempotent, non-destructive:
--   * prescription_items.medicine_name  (new, the name shown everywhere)
--   * prescription_items.medicine_id    (kept, now NULLABLE — set only
--     when the typed name matches an inventory medicine)
--   * existing rows are backfilled from medicines.name
--
--   mysql -u root -p clinic_management < database/migration_017_manual_medicine_names.sql
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- 1. Add medicine_name (nullable first so existing rows are valid)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prescription_items' AND COLUMN_NAME = 'medicine_name'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE prescription_items ADD COLUMN medicine_name VARCHAR(150) NULL AFTER medicine_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Backfill existing prescriptions from the medicines table
UPDATE prescription_items pi
  JOIN medicines m ON m.id = pi.medicine_id
   SET pi.medicine_name = m.name
 WHERE pi.medicine_name IS NULL OR pi.medicine_name = '';

-- Safety net: should not match anything (FK guaranteed a medicine), but
-- guarantees the NOT NULL step below can never fail.
UPDATE prescription_items SET medicine_name = 'Unknown medicine'
 WHERE medicine_name IS NULL OR medicine_name = '';

-- 3. medicine_name is now mandatory; medicine_id becomes optional
ALTER TABLE prescription_items MODIFY COLUMN medicine_name VARCHAR(150) NOT NULL;
ALTER TABLE prescription_items MODIFY COLUMN medicine_id INT NULL;
