-- ============================================================
-- Migration 016: Granular Role Permissions / Staff Management
-- (Nurses, Pharmacists, Lab Staff) / Document Version History
-- — additive, idempotent.
--
--   mysql -u root -p clinic_management < database/migration_016_permissions_staff_documents.sql
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- ------------------------------------------------------------
-- 1. GRANULAR ROLE PERMISSIONS (spec section 17)
--    Base roles (admin/doctor/receptionist/patient) stay exactly as
--    they are — this layers finer-grained permission keys on top so
--    each role's server-side checks can be tightened per-action, and
--    individual users can be granted/denied a specific permission
--    without changing their role. Checked at the API level (see
--    utils/permissions.py) — never only hidden in the UI.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    permission_key VARCHAR(80) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role VARCHAR(20) NOT NULL,
    permission_key VARCHAR(80) NOT NULL,
    PRIMARY KEY (role, permission_key),
    FOREIGN KEY (permission_key) REFERENCES permissions(permission_key) ON DELETE CASCADE
);

-- Per-user overrides. granted=1 adds a permission the role doesn't
-- normally have; granted=0 revokes one the role normally has. Absence
-- of a row means "use the role default". This is how "custom roles"
-- (spec: "Eventually support custom roles") are approximated today
-- without a full custom-role editor: an admin can hand-tune any one
-- user's effective permissions.
CREATE TABLE IF NOT EXISTS user_permission_overrides (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    permission_key VARCHAR(80) NOT NULL,
    granted TINYINT(1) NOT NULL,
    granted_by_user_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_permission (user_id, permission_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_key) REFERENCES permissions(permission_key) ON DELETE CASCADE
);

INSERT IGNORE INTO permissions (permission_key, description, category) VALUES
    ('patient.view_own_records', 'View own medical records', 'patient'),
    ('patient.book_appointment', 'Book an appointment', 'patient'),
    ('patient.view_invoices', 'View own invoices', 'patient'),
    ('patient.cancel_appointment', 'Cancel own appointment', 'patient'),
    ('receptionist.manage_appointments', 'Manage clinic appointments', 'receptionist'),
    ('receptionist.register_patients', 'Register new patients', 'receptionist'),
    ('receptionist.manage_queue', 'Manage the live OPD queue', 'receptionist'),
    ('receptionist.record_triage', 'Record digital triage', 'receptionist'),
    ('receptionist.manage_billing', 'Create invoices and record payments', 'receptionist'),
    ('doctor.view_assigned_patients', 'View patients they have appointments with', 'doctor'),
    ('doctor.create_diagnosis', 'Create a diagnosis', 'doctor'),
    ('doctor.create_prescription', 'Create a prescription', 'doctor'),
    ('doctor.override_triage', 'Override a triage classification', 'doctor'),
    ('triage.override_classification', 'Override a triage classification (any authorized staff)', 'clinical'),
    ('admin.manage_users', 'Create/edit/deactivate user accounts', 'admin'),
    ('admin.manage_staff', 'Manage nurses, pharmacists, lab staff', 'admin'),
    ('admin.view_reports', 'View analytics and financial reports', 'admin'),
    ('admin.manage_system_settings', 'Change system-wide settings', 'admin'),
    ('admin.view_audit_logs', 'View the audit trail', 'admin'),
    ('admin.manage_permissions', 'Grant/revoke per-user permission overrides', 'admin');

INSERT IGNORE INTO role_permissions (role, permission_key) VALUES
    ('patient','patient.view_own_records'), ('patient','patient.book_appointment'),
    ('patient','patient.view_invoices'), ('patient','patient.cancel_appointment'),
    ('receptionist','receptionist.manage_appointments'), ('receptionist','receptionist.register_patients'),
    ('receptionist','receptionist.manage_queue'), ('receptionist','receptionist.record_triage'),
    ('receptionist','receptionist.manage_billing'),
    ('doctor','doctor.view_assigned_patients'), ('doctor','doctor.create_diagnosis'),
    ('doctor','doctor.create_prescription'), ('doctor','doctor.override_triage'),
    ('doctor','triage.override_classification'),
    ('receptionist','triage.override_classification'),
    ('doctor','receptionist.record_triage'), ('doctor','receptionist.manage_billing'),
    ('admin','admin.manage_users'), ('admin','admin.manage_staff'), ('admin','admin.view_reports'),
    ('admin','admin.manage_system_settings'), ('admin','admin.view_audit_logs'), ('admin','admin.manage_permissions');

-- ------------------------------------------------------------
-- 2. STAFF MANAGEMENT (spec section 18) — Nurses, Pharmacists,
--    Lab Staff. A single generic table so new staff types can be
--    added later by inserting a new ENUM value / lookup row rather
--    than a schema rewrite. These are admin-managed personnel
--    records; they do not (yet) get their own login/dashboard —
--    that would be a separate, larger piece of work.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    staff_type ENUM('nurse','pharmacist','lab_technician') NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(150),
    clinic_id INT NOT NULL,
    department VARCHAR(100),
    specialization VARCHAR(150),
    working_hours VARCHAR(100),
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    INDEX idx_staff_clinic_type (clinic_id, staff_type)
);

CREATE TABLE IF NOT EXISTS staff_leaves (
    id INT AUTO_INCREMENT PRIMARY KEY,
    staff_id INT NOT NULL,
    leave_date DATE NOT NULL,
    reason VARCHAR(255),
    status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- 3. DOCUMENT VERSION HISTORY (spec section 15)
--    A new upload of "the same document" links to the original via
--    parent_document_id; is_latest keeps exactly one row per lineage
--    marked current so existing "show me this patient's documents"
--    queries (WHERE is_latest=1) don't need to change.
-- ------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'parent_document_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE documents ADD COLUMN parent_document_id INT NULL AFTER patient_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'version_number'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE documents ADD COLUMN version_number INT NOT NULL DEFAULT 1 AFTER parent_document_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'is_latest'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE documents ADD COLUMN is_latest TINYINT(1) NOT NULL DEFAULT 1 AFTER version_number',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'status'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE documents ADD COLUMN status ENUM(''active'',''archived'') NOT NULL DEFAULT ''active'' AFTER is_latest',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill: every existing row is the root of its own single-version lineage.
UPDATE documents SET parent_document_id = id WHERE parent_document_id IS NULL;

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND CONSTRAINT_NAME = 'fk_documents_parent'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE documents ADD CONSTRAINT fk_documents_parent FOREIGN KEY (parent_document_id) REFERENCES documents(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND INDEX_NAME = 'idx_documents_lineage'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX idx_documents_lineage ON documents (parent_document_id, is_latest)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
