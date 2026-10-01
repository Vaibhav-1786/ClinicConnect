-- ============================================================
-- Migration 015: Patient Journey / Digital Triage / Medication
-- Safety / Live Queue Priority / Customizable Dashboards /
-- Notification Preferences — additive, idempotent.
--
--   mysql -u root -p clinic_management < database/migration_015_journey_triage_safety.sql
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- ------------------------------------------------------------
-- 1. MEDICATION SAFETY — allergen tags on medicines, matched
--    against patients.allergies (free text) at prescribe time.
--    Comma-separated keywords, e.g. "penicillin,amoxicillin".
-- ------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'medicines' AND COLUMN_NAME = 'allergen_tags'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE medicines ADD COLUMN allergen_tags VARCHAR(255) NULL AFTER category',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'medicines' AND COLUMN_NAME = 'batch_number'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE medicines ADD COLUMN batch_number VARCHAR(60) NULL AFTER supplier',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 2. DIGITAL TRIAGE — pre-consultation decision-support record.
--    "category" is a workflow indicator, not a diagnosis, and
--    remains editable by authorized staff (see app-level checks).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_triage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NULL,
    queue_id INT NULL,
    patient_id INT NOT NULL,
    clinic_id INT NOT NULL,
    recorded_by_user_id INT NOT NULL,
    recorded_by_role VARCHAR(20) NOT NULL,
    chief_complaint TEXT,
    symptoms TEXT,
    temperature_f DECIMAL(4,1) NULL,
    blood_pressure VARCHAR(15) NULL,
    pulse INT NULL,
    spo2 INT NULL,
    weight_kg DECIMAL(5,1) NULL,
    height_cm DECIMAL(5,1) NULL,
    pain_level TINYINT NULL,
    emergency_indicator TINYINT(1) DEFAULT 0,
    category ENUM('normal','priority','urgent') DEFAULT 'normal',
    category_reason VARCHAR(255) NULL,
    notes TEXT,
    updated_by_user_id INT NULL,
    updated_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (queue_id) REFERENCES opd_queue(id) ON DELETE SET NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    INDEX idx_triage_queue (queue_id),
    INDEX idx_triage_appt (appointment_id),
    INDEX idx_triage_clinic_date (clinic_id, created_at)
);

-- ------------------------------------------------------------
-- 3. LIVE QUEUE — priority indicator + a "Skipped" state so
--    reception can recall a patient who missed their call.
-- ------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opd_queue' AND COLUMN_NAME = 'priority'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE opd_queue ADD COLUMN priority ENUM(''normal'',''priority'',''urgent'') NOT NULL DEFAULT ''normal'' AFTER status',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE opd_queue MODIFY COLUMN status ENUM(''Waiting'',''Called'',''In Consultation'',''Completed'',''Cancelled'',''No Show'',''Skipped'') DEFAULT ''Waiting''',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opd_queue' AND COLUMN_NAME = 'status' AND COLUMN_TYPE LIKE '%Skipped%'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 4. CUSTOMIZABLE DASHBOARDS — per-user widget preferences.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dashboard_widget_prefs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    widget_key VARCHAR(60) NOT NULL,
    visible TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    layout ENUM('compact','comfortable') NOT NULL DEFAULT 'comfortable',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_widget (user_id, widget_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- 5. NOTIFICATION PREFERENCES — per-user, per-category opt-out.
--    Absence of a row means "enabled" (default-on).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_preferences (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    category VARCHAR(40) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uq_user_category (user_id, category),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- notifications.category — coarse bucket used by the Notification
-- Center UI to group/filter; existing free-text `type` is preserved
-- and mapped into this bucket at write-time (see helpers.add_notification).
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'category'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE notifications ADD COLUMN category VARCHAR(30) NOT NULL DEFAULT ''system'' AFTER type',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'archived'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE notifications ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0 AFTER is_read',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND INDEX_NAME = 'idx_notif_user_category'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX idx_notif_user_category ON notifications (user_id, category, is_read)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill category for existing rows from the free-text `type`, best-effort.
UPDATE notifications SET category='appointment' WHERE category='system' AND type LIKE '%appoint%';
UPDATE notifications SET category='payment' WHERE category='system' AND (type LIKE '%pay%' OR type LIKE '%invoice%' OR type LIKE '%bill%');
UPDATE notifications SET category='prescription' WHERE category='system' AND type LIKE '%prescri%';
UPDATE notifications SET category='laboratory' WHERE category='system' AND (type LIKE '%lab%' OR type LIKE '%report%');
UPDATE notifications SET category='follow_up' WHERE category='system' AND (type LIKE '%follow%');
UPDATE notifications SET category='emergency' WHERE category='system' AND (type LIKE '%sos%' OR type LIKE '%emergency%');
