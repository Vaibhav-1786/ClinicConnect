-- Migration 002: support "Continue with Google" for patients.
--
-- Adds a nullable, unique google_id (the verified Google account's stable
-- "sub" claim) to users. Patients who sign in with Google are matched by
-- this column first, then by verified email. Existing password-based
-- accounts are completely unaffected — password_hash is untouched and
-- normal email/password login keeps working exactly as before.

-- Idempotent: schema.sql (the canonical current-state file) already
-- includes google_id for fresh installs, so this migration only needs to
-- act when upgrading an existing database created before this feature.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'google_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN google_id VARCHAR(255) NULL UNIQUE AFTER phone',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
