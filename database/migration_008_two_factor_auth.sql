-- ============================================================
-- Migration 008: Two-Factor Authentication (OTP-based)
-- Idempotent: safe to re-run on an existing database.
-- ============================================================
SET NAMES utf8mb4;
USE clinic_management;

CREATE TABLE IF NOT EXISTS two_factor_settings (
    user_id INT PRIMARY KEY,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Never stores the OTP in plaintext (otp_hash only). `pending_token` is the
-- opaque handle the client holds between "credentials verified" and "OTP
-- verified" — it identifies the pending login, it is NOT a session/JWT.
-- `response_payload` caches the role-specific login response (e.g. the
-- doctor/clinic/organizations object) that would have been returned had 2FA
-- not been required, so /verify-otp can return an identical shape on success
-- without re-deriving it and without a second round of business logic.
CREATE TABLE IF NOT EXISTS otp_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    role VARCHAR(20) NOT NULL,
    pending_token VARCHAR(64) NOT NULL UNIQUE,
    otp_hash VARCHAR(255) NOT NULL,
    extra_claims TEXT,               -- JSON: claims to embed in the final JWT (profile_id, clinic_id, ...)
    response_payload TEXT,           -- JSON: the rest of the login response body
    purpose VARCHAR(20) NOT NULL DEFAULT 'login',
    attempts INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_otp_pending (pending_token)
);
