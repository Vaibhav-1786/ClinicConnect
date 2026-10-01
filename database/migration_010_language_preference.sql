-- ============================================================
-- Migration 010: Language preference (Hindi/Gujarati/English)
-- Idempotent: safe to re-run on an existing database.
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'preferred_language'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN preferred_language ENUM(''en'',''hi'',''gu'') NOT NULL DEFAULT ''en''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
