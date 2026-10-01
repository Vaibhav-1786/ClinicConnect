-- Adds support for voice (audio) messages in the doctor <-> patient
-- conversation thread. Idempotent: safe to re-run.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'patient_messages' AND COLUMN_NAME = 'message_type'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE patient_messages ADD COLUMN message_type ENUM(''text'',''audio'') NOT NULL DEFAULT ''text'' AFTER message',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'patient_messages' AND COLUMN_NAME = 'audio_path'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE patient_messages ADD COLUMN audio_path VARCHAR(255) NULL AFTER message_type',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;