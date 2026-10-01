-- ============================================================
-- Migration 012: Post-visit care checklist, second opinion requests,
-- consent/document vault, SOS alerts, and reminder-escalation tasks.
-- Idempotent: safe to re-run on an existing database.
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- ---------- 1. Post-visit care checklist ----------
CREATE TABLE IF NOT EXISTS care_checklist_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    item_text VARCHAR(255) NOT NULL,
    category ENUM('lifestyle','follow_up','medication','warning_sign','other') DEFAULT 'other',
    due_date DATE NULL,
    is_done TINYINT(1) NOT NULL DEFAULT 0,
    done_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    INDEX idx_checklist_patient (patient_id),
    INDEX idx_checklist_appointment (appointment_id)
);

-- ---------- 2. Second opinion requests ----------
CREATE TABLE IF NOT EXISTS second_opinion_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    prescription_id INT NULL,
    appointment_id INT NULL,
    original_doctor_id INT NOT NULL,
    target_doctor_id INT NOT NULL,
    patient_note TEXT,
    consent_given TINYINT(1) NOT NULL DEFAULT 0,
    status ENUM('PENDING','ACCEPTED','DECLINED','REVIEWED') NOT NULL DEFAULT 'PENDING',
    opinion_text TEXT NULL,
    responded_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE SET NULL,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
    FOREIGN KEY (original_doctor_id) REFERENCES doctors(id),
    FOREIGN KEY (target_doctor_id) REFERENCES doctors(id),
    INDEX idx_secopinion_patient (patient_id),
    INDEX idx_secopinion_target (target_doctor_id, status)
);

-- ---------- 3. Consent & document vault ----------
CREATE TABLE IF NOT EXISTS consent_documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    doc_type ENUM('consent_form','insurance','id_proof','other') NOT NULL DEFAULT 'other',
    title VARCHAR(200) NOT NULL,
    notes TEXT,
    is_signed TINYINT(1) NOT NULL DEFAULT 0,
    signature_name VARCHAR(150) NULL,
    signed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    INDEX idx_consent_patient (patient_id)
);

-- ---------- 4. SOS alerts ----------
CREATE TABLE IF NOT EXISTS sos_alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    clinic_id INT NULL,
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    status ENUM('SENT','ACKNOWLEDGED','RESOLVED') NOT NULL DEFAULT 'SENT',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL,
    INDEX idx_sos_patient (patient_id)
);

-- ---------- 5. Reminder escalation ----------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'medicine_reminder_logs' AND COLUMN_NAME = 'escalated'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE medicine_reminder_logs ADD COLUMN escalated TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN escalated_at TIMESTAMP NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS reminder_escalation_tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reminder_log_id INT NOT NULL,
    patient_id INT NOT NULL,
    clinic_id INT NULL,
    reason VARCHAR(255),
    status ENUM('OPEN','CALLED','RESOLVED') NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    FOREIGN KEY (reminder_log_id) REFERENCES medicine_reminder_logs(id) ON DELETE CASCADE,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL,
    INDEX idx_escalation_status (clinic_id, status)
);
