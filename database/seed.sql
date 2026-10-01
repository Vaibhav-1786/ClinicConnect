USE clinic_management;

-- States / Cities / Areas
INSERT INTO states (name) VALUES ('Gujarat'), ('Maharashtra');

INSERT INTO cities (state_id, name) VALUES
 ((SELECT id FROM states WHERE name='Gujarat'), 'Ahmedabad'),
 ((SELECT id FROM states WHERE name='Gujarat'), 'Surat'),
 ((SELECT id FROM states WHERE name='Maharashtra'), 'Mumbai');

INSERT INTO areas (city_id, name) VALUES
 ((SELECT id FROM cities WHERE name='Ahmedabad'), 'Satellite'),
 ((SELECT id FROM cities WHERE name='Ahmedabad'), 'Vastrapur'),
 ((SELECT id FROM cities WHERE name='Ahmedabad'), 'Navrangpura'),
 ((SELECT id FROM cities WHERE name='Ahmedabad'), 'Maninagar'),
 ((SELECT id FROM cities WHERE name='Ahmedabad'), 'Bopal'),
 ((SELECT id FROM cities WHERE name='Surat'), 'Adajan'),
 ((SELECT id FROM cities WHERE name='Mumbai'), 'Andheri');

-- Users: 1 patient, 1 receptionist, 1 doctor (password for all = "Password123")
-- password_hash generated with werkzeug generate_password_hash (see backend seed_demo.py alternative)
-- Placeholder hashes below are replaced by running backend/seed_demo.py which hashes properly.

-- Clinics
INSERT INTO clinics (name, type, address, state_id, city_id, area_id, contact_number, email, opening_time, closing_time)
VALUES
('Sunrise Multispecialty Clinic', 'clinic', '12 Satellite Road', 1,
   (SELECT id FROM cities WHERE name='Ahmedabad'),
   (SELECT id FROM areas WHERE name='Satellite'),
   '9998887771', 'contact@sunrise.example', '09:00:00', '20:00:00'),
('Vastrapur City Hospital', 'hospital', '45 Vastrapur Lake Road', 1,
   (SELECT id FROM cities WHERE name='Ahmedabad'),
   (SELECT id FROM areas WHERE name='Vastrapur'),
   '9998887772', 'contact@vastrapurhospital.example', '08:00:00', '21:00:00');

-- Medicines
INSERT INTO medicines (name, category, price, stock, expiry_date, supplier) VALUES
('Paracetamol 500mg', 'Analgesic', 20.00, 500, '2027-06-01', 'MedSupply Co'),
('Amoxicillin 250mg', 'Antibiotic', 45.00, 300, '2026-12-01', 'MedSupply Co'),
('Warfarin 5mg', 'Anticoagulant', 60.00, 100, '2026-10-01', 'PharmaDist'),
('Aspirin 75mg', 'Antiplatelet', 15.00, 400, '2027-01-01', 'PharmaDist');

INSERT INTO drug_interactions (medicine_a_id, medicine_b_id, severity, description) VALUES
((SELECT id FROM medicines WHERE name='Warfarin 5mg'), (SELECT id FROM medicines WHERE name='Aspirin 75mg'),
 'severe', 'Increased risk of bleeding when combined.');

-- Lab tests
INSERT INTO lab_tests (test_name, normal_range, unit, price) VALUES
('Complete Blood Count', '4.5-11.0', 'x10^9/L', 300.00),
('Blood Sugar Fasting', '70-100', 'mg/dL', 150.00),
('Lipid Profile', '<200', 'mg/dL', 500.00);
