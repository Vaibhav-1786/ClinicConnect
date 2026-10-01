-- ============================================================
-- Migration 006: Doctor Note Templates, Consultation Notes
--                (backs Voice Notes, Note Templates, and the
--                 Cross-Organization Patient History view)
-- Idempotent: safe to re-run on an existing database.
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

CREATE TABLE IF NOT EXISTS doctor_note_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    clinic_id INT NULL,                     -- optional: template scoped to one organization
    title VARCHAR(150) NOT NULL,
    chief_complaint TEXT,
    examination TEXT,
    assessment TEXT,
    plan TEXT,
    follow_up TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL,
    INDEX idx_template_doctor (doctor_id)
);

-- One row per appointment, upserted as the doctor edits during/after a visit.
-- Richer than the pre-existing soap_notes table (adds chief_complaint/follow_up
-- to match the note-template structure) without touching soap_notes itself.
CREATE TABLE IF NOT EXISTS consultation_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL UNIQUE,
    doctor_id INT NOT NULL,
    patient_id INT NOT NULL,
    chief_complaint TEXT,
    examination TEXT,
    assessment TEXT,
    plan TEXT,
    follow_up TEXT,
    source ENUM('typed','voice','template') NOT NULL DEFAULT 'typed',
    template_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES doctor_note_templates(id) ON DELETE SET NULL,
    INDEX idx_consult_patient (patient_id)
);
