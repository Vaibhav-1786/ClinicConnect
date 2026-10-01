-- ============================================================
-- Migration 014: Admin Command Center — Foundational Data Model
--
-- Adds only what does NOT already exist:
--   - geocoordinates (needed by the map + distance-based matching)
--   - consultation_type + conflict-detection support on the existing
--     doctor_availability table (this project's existing multi-clinic
--     schedule table — no new "doctor_organizations" table is created,
--     clinic_doctors + doctor_availability already model that relationship)
--   - persisted history/snapshot tables for scoring & capacity trends
--   - new subsystem tables: alerts, comments, QR profiles, duplicate
--     detection, application timeline, risk scores, forecasts,
--     recommendation engine cache + configurable weights
--
-- Idempotent: safe to re-run on an existing database. Purely additive —
-- nothing is dropped, renamed, or destructively backfilled.
--   mysql -u root -p clinic_management < database/migration_014_command_center_foundation.sql
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- ============================================================
-- 1. GEOCOORDINATES (clinics) — required by the map, distance
--    scoring in the matching engine, and forecasting-by-area.
-- ============================================================
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clinics' AND COLUMN_NAME = 'latitude'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE clinics ADD COLUMN latitude DECIMAL(10,7) NULL AFTER map_location, ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clinics' AND INDEX_NAME = 'idx_clinic_geo'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX idx_clinic_geo ON clinics (latitude, longitude)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Doctors get an optional "home area" point too (used for the map's doctor
-- marker and as a matching-engine input independent of any one clinic).
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'doctors' AND COLUMN_NAME = 'latitude'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE doctors ADD COLUMN latitude DECIMAL(10,7) NULL AFTER area_id, ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- 2. MULTI-CLINIC SCHEDULING — extend the existing
--    doctor_availability table rather than creating a parallel one.
-- ============================================================
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'doctor_availability' AND COLUMN_NAME = 'consultation_type'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE doctor_availability
     ADD COLUMN consultation_type ENUM(''in_person'',''teleconsultation'',''both'') NOT NULL DEFAULT ''in_person'' AFTER end_time,
     ADD COLUMN slot_duration_minutes INT NULL AFTER consultation_type,
     ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER slot_duration_minutes,
     ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER is_active',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Conflicts are detected in the service layer (two active rows for the same
-- doctor, same day_of_week, with overlapping [start_time,end_time) across
-- DIFFERENT clinics) rather than enforced by a DB constraint, since MySQL
-- has no native "no overlapping ranges" constraint. This index makes that
-- lookup fast.
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'doctor_availability' AND INDEX_NAME = 'idx_avail_conflict_check'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX idx_avail_conflict_check ON doctor_availability (doctor_id, day_of_week, is_active)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- 3. RECOMMENDATION ENGINE (doctor <-> organization matching)
-- ============================================================
-- Single configurable weight profile. Row id=1 is the active/default
-- profile; admins may add named alternates later without a schema change.
CREATE TABLE IF NOT EXISTS match_weight_profiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL DEFAULT 'default',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    location_weight DECIMAL(5,2) NOT NULL DEFAULT 25.00,
    specialization_weight DECIMAL(5,2) NOT NULL DEFAULT 25.00,
    availability_weight DECIMAL(5,2) NOT NULL DEFAULT 20.00,
    capacity_weight DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    distance_weight DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    doctor_distribution_weight DECIMAL(5,2) NOT NULL DEFAULT 5.00,
    updated_by_admin_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT INTO match_weight_profiles (id, name, is_active)
  SELECT 1, 'default', 1 FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM match_weight_profiles WHERE id = 1);

-- Cached, explainable match results. Recomputed on demand (doctor created/
-- approved/assigned) rather than kept live, so every score is reproducible
-- and inspectable after the fact ("why was this recommended").
CREATE TABLE IF NOT EXISTS organization_recommendations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NULL,
    application_id INT NULL,
    clinic_id INT NOT NULL,
    match_score DECIMAL(5,2) NOT NULL,
    location_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    specialization_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    availability_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    capacity_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    distance_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    distribution_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    distance_km DECIMAL(8,2) NULL,
    reasons JSON NULL,
    weight_profile_id INT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (application_id) REFERENCES doctor_applications(id) ON DELETE CASCADE,
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    FOREIGN KEY (weight_profile_id) REFERENCES match_weight_profiles(id),
    INDEX idx_reco_doctor (doctor_id, match_score),
    INDEX idx_reco_application (application_id, match_score)
);

-- ============================================================
-- 4. DOCTOR PERFORMANCE SCORE — persisted so trend/"previous
--    score"/"↑ N points this month" are real historical facts,
--    not recomputed guesses.
-- ============================================================
CREATE TABLE IF NOT EXISTS performance_weight_profiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL DEFAULT 'default',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    completion_weight DECIMAL(5,2) NOT NULL DEFAULT 25.00,
    cancellation_weight DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    feedback_weight DECIMAL(5,2) NOT NULL DEFAULT 20.00,
    response_time_weight DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    profile_completeness_weight DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    document_verification_weight DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    patient_retention_weight DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    updated_by_admin_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT INTO performance_weight_profiles (id, name, is_active)
  SELECT 1, 'default', 1 FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM performance_weight_profiles WHERE id = 1);

CREATE TABLE IF NOT EXISTS doctor_performance_scores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    score_date DATE NOT NULL,
    overall_score DECIMAL(5,2) NOT NULL,
    completion_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    cancellation_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    feedback_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    response_time_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    profile_completeness_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    document_verification_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    patient_retention_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    category ENUM('EXCELLENT','GOOD','NEEDS_ATTENTION','CRITICAL') NOT NULL,
    inputs_snapshot JSON NULL,
    weight_profile_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (weight_profile_id) REFERENCES performance_weight_profiles(id),
    UNIQUE KEY uq_doctor_score_date (doctor_id, score_date),
    INDEX idx_perf_doctor_date (doctor_id, score_date)
);

-- Patient feedback backing the feedback_score already exists as the
-- `feedback` table (appointment_id, patient_id, doctor_id, clinic_id,
-- rating, comment) — reused as-is, no parallel table created here.

-- ============================================================
-- 5. CLINIC CAPACITY — daily snapshots so "today vs yesterday vs
--    this week" trends are real recorded values.
-- ============================================================
CREATE TABLE IF NOT EXISTS clinic_capacity_snapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    clinic_id INT NOT NULL,
    snapshot_date DATE NOT NULL,
    doctor_count INT NOT NULL DEFAULT 0,
    department_count INT NOT NULL DEFAULT 0,
    appointments_count INT NOT NULL DEFAULT 0,
    available_slots INT NOT NULL DEFAULT 0,
    utilization_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
    capacity_level ENUM('LOW','NORMAL','HIGH','CRITICAL') NOT NULL DEFAULT 'LOW',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    UNIQUE KEY uq_clinic_snapshot_date (clinic_id, snapshot_date),
    INDEX idx_capacity_clinic_date (clinic_id, snapshot_date)
);

-- ============================================================
-- 6. SMART ALERT CENTER
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    severity ENUM('URGENT','ATTENTION','INFORMATION') NOT NULL,
    alert_type VARCHAR(60) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(500) NULL,
    entity_type VARCHAR(40) NULL,
    entity_id INT NULL,
    action_label VARCHAR(60) NULL,
    action_url VARCHAR(255) NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    is_resolved TINYINT(1) NOT NULL DEFAULT 0,
    resolved_by_admin_id INT NULL,
    resolved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (resolved_by_admin_id) REFERENCES users(id),
    INDEX idx_alert_state (is_resolved, is_read, severity),
    INDEX idx_alert_entity (entity_type, entity_id)
);

-- ============================================================
-- 7. APPLICATION TIMELINE — immutable, append-only event log
--    per doctor_applications row (distinct from admin_audit_logs:
--    this is the applicant-facing/reviewable step sequence).
-- ============================================================
CREATE TABLE IF NOT EXISTS application_timeline_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NOT NULL,
    step_key ENUM(
      'SUBMITTED','DOCUMENTS_UPLOADED','ADMIN_REVIEW','DOCUMENTS_VERIFIED',
      'ORGANIZATION_ASSIGNED','APPROVED','REJECTED','DOCTOR_ACTIVE'
    ) NOT NULL,
    status ENUM('PENDING','IN_PROGRESS','DONE','SKIPPED') NOT NULL DEFAULT 'DONE',
    performed_by_admin_id INT NULL,
    comment VARCHAR(500) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES doctor_applications(id) ON DELETE CASCADE,
    FOREIGN KEY (performed_by_admin_id) REFERENCES users(id),
    INDEX idx_timeline_application (application_id, created_at)
);
-- Immutability is enforced at the application layer (INSERT-only service,
-- no UPDATE/DELETE route exposed for this table), matching this project's
-- existing convention for audit_logs.

-- ============================================================
-- 8. ADMIN AUDIT LOG — already exists (audit_logs, extended in
--    migration_007). No new table needed; just widen `action` reach
--    isn't required since add_audit() accepts any action string.
-- ============================================================

-- ============================================================
-- 9. QR CODE DOCTOR PROFILE
-- ============================================================
CREATE TABLE IF NOT EXISTS doctor_qr_profiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL UNIQUE,
    public_token VARCHAR(64) NOT NULL UNIQUE,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    regenerated_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);
-- public_token is a random opaque string (see services/qr_profile.py, to be
-- added in the API phase) — never the internal doctor_id — so the QR/URL
-- can be freely printed/scanned without exposing the database ID.

-- ============================================================
-- 10. VERIFICATION BADGES — layered on top of the existing
--     doctors.verification_status / clinics.approval_status columns
--     rather than replacing them, since a doctor can be individually
--     "Documents Verified" before being fully "Verified Doctor".
-- ============================================================
CREATE TABLE IF NOT EXISTS doctor_verification_badges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    badge_type ENUM('VERIFIED_DOCTOR','DOCUMENTS_VERIFIED','ORGANIZATION_VERIFIED','PROFILE_VERIFIED') NOT NULL,
    is_granted TINYINT(1) NOT NULL DEFAULT 1,
    granted_by_admin_id INT NULL,
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by_admin_id) REFERENCES users(id),
    UNIQUE KEY uq_doctor_badge (doctor_id, badge_type)
);
-- Every insert/update here MUST also call app.utils.helpers.add_audit() —
-- enforced in the service layer, not the database.

-- ============================================================
-- 11. DUPLICATE DOCTOR DETECTION
-- ============================================================
CREATE TABLE IF NOT EXISTS duplicate_detection_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NULL,
    doctor_id INT NULL,
    matched_doctor_id INT NOT NULL,
    overall_match_pct DECIMAL(5,2) NOT NULL,
    name_match_pct DECIMAL(5,2) NULL,
    registration_number_match_pct DECIMAL(5,2) NULL,
    mobile_match_pct DECIMAL(5,2) NULL,
    email_match_pct DECIMAL(5,2) NULL,
    dob_match_pct DECIMAL(5,2) NULL,
    admin_decision ENUM('PENDING','VIEWED_EXISTING','CONTINUED_ANYWAY','MERGED') NOT NULL DEFAULT 'PENDING',
    decided_by_admin_id INT NULL,
    decided_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES doctor_applications(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (matched_doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    INDEX idx_dup_application (application_id),
    INDEX idx_dup_doctor (doctor_id)
);
-- No automatic merge is ever performed by code against this table — the
-- table only ever records candidate matches and the admin's decision.

-- ============================================================
-- 12. INTERNAL ADMIN COMMENTS (polymorphic, private-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entity_type ENUM('APPLICATION','DOCTOR','CLINIC','DOCUMENT','VERIFICATION') NOT NULL,
    entity_id INT NOT NULL,
    author_admin_id INT NOT NULL,
    comment TEXT NOT NULL,
    is_edited TINYINT(1) NOT NULL DEFAULT 0,
    edited_at TIMESTAMP NULL,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_admin_id) REFERENCES users(id),
    INDEX idx_comment_entity (entity_type, entity_id, created_at)
);
-- Soft-delete only (is_deleted flag) — comments are never hard-deleted so
-- audit trails referencing them stay intact. This table is never joined
-- into any public/patient-facing profile query.

-- ============================================================
-- 13. APPLICATION RISK SCORE
-- ============================================================
CREATE TABLE IF NOT EXISTS application_risk_scores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NOT NULL,
    risk_score DECIMAL(5,2) NOT NULL,
    risk_level ENUM('LOW','MODERATE','HIGH','CRITICAL') NOT NULL,
    factors JSON NULL,
    computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES doctor_applications(id) ON DELETE CASCADE,
    INDEX idx_risk_application (application_id, computed_at)
);
-- Never referenced by any auto-reject logic; admins always make the
-- approve/reject decision on doctor_applications.status themselves.

-- ============================================================
-- 14. PREDICTIVE APPOINTMENT FORECASTS
-- ============================================================
CREATE TABLE IF NOT EXISTS appointment_forecasts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    scope_type ENUM('CITY','SPECIALIZATION','CLINIC','GLOBAL') NOT NULL,
    scope_value VARCHAR(150) NULL,
    forecast_period_start DATE NOT NULL,
    forecast_period_end DATE NOT NULL,
    historical_avg_volume DECIMAL(10,2) NULL,
    predicted_volume DECIMAL(10,2) NOT NULL,
    predicted_change_pct DECIMAL(6,2) NULL,
    confidence_pct DECIMAL(5,2) NOT NULL,
    recommendation_text VARCHAR(500) NULL,
    factors JSON NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_forecast_scope (scope_type, scope_value, forecast_period_start)
);
-- All forecast API responses must include is_estimate=true / confidence_pct
-- alongside predicted_volume — enforced by the serializer, not the schema.

-- ============================================================
-- 15. AI ADMIN ASSISTANT — activity/audit log for AI-driven queries
--     and any AI-proposed (never AI-executed) actions.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_admin_activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_user_id INT NOT NULL,
    query_text VARCHAR(2000) NOT NULL,
    interpreted_intent VARCHAR(100) NULL,
    applied_filters JSON NULL,
    result_summary VARCHAR(500) NULL,
    proposed_action VARCHAR(100) NULL,
    action_confirmed TINYINT(1) NOT NULL DEFAULT 0,
    confirmed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES users(id),
    INDEX idx_ai_admin_user (admin_user_id, created_at)
);
-- Any row with proposed_action set MUST have action_confirmed=1 (set only
-- via the admin's explicit confirm click) before the underlying mutating
-- endpoint is ever called — enforced in app/routes/ai.py, not here.

-- ============================================================
-- 16. GAMIFIED ADMIN PRODUCTIVITY (optional / configurable)
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_productivity_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    is_enabled TINYINT(1) NOT NULL DEFAULT 0,
    updated_by_admin_id INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT INTO admin_productivity_settings (id, is_enabled)
  SELECT 1, 0 FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM admin_productivity_settings WHERE id = 1);
-- Daily productivity numbers themselves are computed on demand from
-- doctor_applications.reviewed_by_admin_id / reviewed_at + audit_logs,
-- which already exist — no separate leaderboard table required.
