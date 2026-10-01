-- ============================================================
-- Migration 009: Teleconsultation (WebRTC video consultation)
-- Idempotent: safe to re-run on an existing database.
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

-- ---------- Mark an appointment as online vs in-person ----------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_requests' AND COLUMN_NAME = 'consultation_mode'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE appointment_requests ADD COLUMN consultation_mode ENUM(''IN_PERSON'',''ONLINE'') NOT NULL DEFAULT ''IN_PERSON'' AFTER reason',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointments' AND COLUMN_NAME = 'consultation_mode'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE appointments ADD COLUMN consultation_mode ENUM(''IN_PERSON'',''ONLINE'') NOT NULL DEFAULT ''IN_PERSON'' AFTER reason',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- Video sessions (one per appointment) ----------
CREATE TABLE IF NOT EXISTS video_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL UNIQUE,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    clinic_id INT NOT NULL,
    status ENUM('SCHEDULED','ACTIVE','ENDED') NOT NULL DEFAULT 'SCHEDULED',
    patient_joined_at TIMESTAMP NULL,
    patient_left_at TIMESTAMP NULL,
    doctor_joined_at TIMESTAMP NULL,
    doctor_left_at TIMESTAMP NULL,
    started_at TIMESTAMP NULL,
    ended_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE
);

-- ---------- WebRTC signaling relay (HTTP long-poll based) ----------
-- This project has no WebSocket/async server infrastructure (plain sync
-- Flask), so signaling is done via a small polling relay table instead of
-- adding a new server runtime (e.g. Flask-SocketIO + eventlet) that would
-- change how the whole app is deployed. Each peer POSTs its SDP offer/answer
-- and ICE candidates here and polls for the other side's messages. This is a
-- legitimate, well-established WebRTC signaling pattern, just not the only
-- one — swap in a WebSocket relay later without touching the peer-connection
-- logic if sub-second signaling latency ever matters.
CREATE TABLE IF NOT EXISTS video_signals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    sender_role ENUM('patient','doctor') NOT NULL,
    signal_type ENUM('offer','answer','ice-candidate','leave') NOT NULL,
    payload TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES video_sessions(id) ON DELETE CASCADE,
    INDEX idx_signal_session (session_id, id)
);
