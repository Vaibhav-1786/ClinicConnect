-- ============================================================
-- Migration 013: Account Recovery hardening
-- Safe / additive: only ADDs a column and an index. Nothing is
-- dropped, renamed, or backfilled destructively, so all existing
-- features keep working unchanged.
-- Run this once, after the earlier migrations, on an existing database:
--   mysql -u root -p clinic_management < database/migration_013_account_recovery.sql
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- ---------- users: track when the password last changed ----------
-- Used to invalidate any JWT issued before a password reset/change, even
-- though sessions are otherwise stateless (see backend/app/utils/auth.py).
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_changed_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP NULL AFTER password_hash',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- users: index the reset token lookup used on every ----------
-- ---------- /api/auth/reset-password request ----------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_reset_token'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE users ADD INDEX idx_users_reset_token (reset_token)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
