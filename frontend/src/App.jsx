import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { LanguageProvider } from "./context/LanguageContext";
import { ThemeProvider } from "./context/ThemeContext";
import ProtectedRoute from "./routes/ProtectedRoute";

import Login from "./pages/auth/Login";
import PublicDoctorProfile from "./pages/PublicDoctorProfile";

import PatientRegister from "./pages/patient/Register";
import PatientForgotPassword from "./pages/patient/ForgotPassword";
import PatientResetPassword from "./pages/patient/ResetPassword";
import DoctorForgotPassword from "./pages/doctor/ForgotPassword";
import DoctorForgotId from "./pages/doctor/ForgotId";
import ReceptionistForgotPassword from "./pages/receptionist/ForgotPassword";
import ReceptionistForgotId from "./pages/receptionist/ForgotId";
import ForgotClinicId from "./pages/shared/ForgotClinicId";
import PatientDashboard from "./pages/patient/Dashboard";
import FindClinics from "./pages/patient/FindClinics";
import PatientAppointments from "./pages/patient/Appointments";
import PatientPrescriptions from "./pages/patient/Prescriptions";
import PatientPayments from "./pages/patient/Payments";
import PatientProfile from "./pages/patient/Profile";
import PatientFamily from "./pages/patient/Family";
import PatientRecurringAppointments from "./pages/patient/RecurringAppointments";
import PatientWaitlist from "./pages/patient/Waitlist";
import PatientMedicineReminders from "./pages/patient/MedicineReminders";
import PatientInsurance from "./pages/patient/Insurance";
import PatientHealthTimeline from "./pages/patient/HealthTimeline";
import PatientFindSpecialist from "./pages/patient/FindSpecialist";
import PatientVideoConsultation from "./pages/patient/VideoConsultation";
import SearchResults from "./pages/shared/SearchResults";
import SecuritySettings from "./pages/shared/SecuritySettings";
import PatientCareChecklist from "./pages/patient/CareChecklist";
import PatientSecondOpinion from "./pages/patient/SecondOpinion";
import PatientConsentVault from "./pages/patient/ConsentVault";

import ReceptionistDashboard from "./pages/receptionist/Dashboard";
import ReceptionistAppointments from "./pages/receptionist/Appointments";
import ReceptionistPatients from "./pages/receptionist/Patients";
import ReceptionistBilling from "./pages/receptionist/Billing";
import ReceptionistWaitlist from "./pages/receptionist/Waitlist";
import ReceptionistQueue from "./pages/receptionist/Queue";
import ReceptionistBulkNotifications from "./pages/receptionist/BulkNotifications";
import ReceptionistNoShowRisk from "./pages/receptionist/NoShowRisk";
import ReceptionistReminderEscalations from "./pages/receptionist/ReminderEscalations";

import DoctorDashboard from "./pages/doctor/Dashboard";
import DoctorAppointments from "./pages/doctor/Appointments";
import DoctorAvailability from "./pages/doctor/Availability";
import DoctorOrganizations from "./pages/doctor/Organizations";
import DoctorReceptionists from "./pages/doctor/Receptionists";
import DoctorQueue from "./pages/doctor/Queue";
import DoctorVideoConsultation from "./pages/doctor/VideoConsultation";
import DoctorNoteTemplates from "./pages/doctor/NoteTemplates";
import DoctorPatientHistory from "./pages/doctor/PatientHistory";
import DoctorSecondOpinionInbox from "./pages/doctor/SecondOpinionInbox";

import AdminDashboard from "./pages/admin/Dashboard";
import AdminApplications from "./pages/admin/Applications";
import AdminApplicationNew from "./pages/admin/ApplicationNew";
import AdminApplicationDetail from "./pages/admin/ApplicationDetail";
import AdminDoctors from "./pages/admin/Doctors";
import AdminDoctorDetail from "./pages/admin/DoctorDetail";
import AdminClinics from "./pages/admin/Clinics";
import AdminClinicDetail from "./pages/admin/ClinicDetail";
import AdminReceptionists from "./pages/admin/Receptionists";
import AdminWaitlist from "./pages/admin/Waitlist";
import AdminAnalytics from "./pages/admin/Analytics";
import AdminDoctorPerformance from "./pages/admin/DoctorPerformance";
import AdminDocumentExpiry from "./pages/admin/DocumentExpiry";
import AdminAuditLogs from "./pages/admin/AuditLogs";
import AdminAlertCenter from "./pages/admin/AlertCenter";
import AdminAIAssistant from "./pages/admin/AIAssistant";
import AdminHealthcareMap from "./pages/admin/HealthcareMap";
import AdminForecast from "./pages/admin/Forecast";
import AdminProductivity from "./pages/admin/Productivity";
import AdminStaffManagement from "./pages/admin/StaffManagement";
import AdminPermissions from "./pages/admin/Permissions";

import NotFound from "./pages/NotFound";

function RootRedirect() {
  const { token, role } = useAuth();
  if (token && role) return <Navigate to={`/${role}/dashboard`} replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <ToastProvider>
        <LanguageProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<RootRedirect />} />

            {/*
              URL-based role login. Every one of these renders the SAME
              <Login/> component, which reads the URL to decide which single
              form to show. There is no page anywhere that lists more than
              one role's login at once.
            */}
            <Route path="/login" element={<Login />} />
            <Route path="/patient" element={<Login />} />
            <Route path="/patient/login" element={<Login />} />
            <Route path="/receptionist" element={<Login />} />
            <Route path="/receptionist/login" element={<Login />} />
            <Route path="/doctor" element={<Login />} />
            <Route path="/doctor/login" element={<Login />} />
            <Route path="/admin/login" element={<Login />} />

            {/* Public QR-code doctor profile — no auth required */}
            <Route path="/doctor-profile/:token" element={<PublicDoctorProfile />} />

            {/* Patient */}
            <Route path="/patient/register" element={<PatientRegister />} />
            <Route path="/patient/forgot-password" element={<PatientForgotPassword />} />
            <Route path="/patient/reset-password" element={<PatientResetPassword />} />
            <Route path="/reset-password" element={<PatientResetPassword />} />

            {/*
              Shared account-recovery flow for Doctor & Receptionist. The
              account type is already known from the URL, so there is no
              separate "pick your role" step — each role goes straight to
              its own recovery form (per the spec).
            */}
            <Route path="/doctor/forgot-password" element={<DoctorForgotPassword />} />
            <Route path="/doctor/forgot-id" element={<DoctorForgotId />} />
            <Route path="/doctor/forgot-clinic-id" element={<ForgotClinicId role="doctor" />} />
            <Route path="/doctor/reset-password" element={<PatientResetPassword />} />

            <Route path="/receptionist/forgot-password" element={<ReceptionistForgotPassword />} />
            <Route path="/receptionist/forgot-id" element={<ReceptionistForgotId />} />
            <Route path="/receptionist/forgot-clinic-id" element={<ForgotClinicId role="receptionist" />} />
            <Route path="/receptionist/reset-password" element={<PatientResetPassword />} />
            <Route path="/patient/dashboard" element={<ProtectedRoute role="patient"><PatientDashboard /></ProtectedRoute>} />
            <Route path="/patient/clinics" element={<ProtectedRoute role="patient"><FindClinics /></ProtectedRoute>} />
            <Route path="/patient/appointments" element={<ProtectedRoute role="patient"><PatientAppointments /></ProtectedRoute>} />
            <Route path="/patient/prescriptions" element={<ProtectedRoute role="patient"><PatientPrescriptions /></ProtectedRoute>} />
            <Route path="/patient/payments" element={<ProtectedRoute role="patient"><PatientPayments /></ProtectedRoute>} />
            <Route path="/patient/profile" element={<ProtectedRoute role="patient"><PatientProfile /></ProtectedRoute>} />
            <Route path="/patient/family" element={<ProtectedRoute role="patient"><PatientFamily /></ProtectedRoute>} />
            <Route path="/patient/recurring-appointments" element={<ProtectedRoute role="patient"><PatientRecurringAppointments /></ProtectedRoute>} />
            <Route path="/patient/waitlist" element={<ProtectedRoute role="patient"><PatientWaitlist /></ProtectedRoute>} />
            <Route path="/patient/medicine-reminders" element={<ProtectedRoute role="patient"><PatientMedicineReminders /></ProtectedRoute>} />
            <Route path="/patient/insurance" element={<ProtectedRoute role="patient"><PatientInsurance /></ProtectedRoute>} />
            <Route path="/patient/health-timeline" element={<ProtectedRoute role="patient"><PatientHealthTimeline /></ProtectedRoute>} />
            <Route path="/patient/find-specialist" element={<ProtectedRoute role="patient"><PatientFindSpecialist /></ProtectedRoute>} />
            <Route path="/patient/video-consultation" element={<ProtectedRoute role="patient"><PatientVideoConsultation /></ProtectedRoute>} />
            <Route path="/patient/video-consultation/:appointmentId" element={<ProtectedRoute role="patient"><PatientVideoConsultation /></ProtectedRoute>} />
            <Route path="/patient/search" element={<ProtectedRoute role="patient"><SearchResults /></ProtectedRoute>} />
            <Route path="/patient/security" element={<ProtectedRoute role="patient"><SecuritySettings /></ProtectedRoute>} />
            <Route path="/patient/care-checklist" element={<ProtectedRoute role="patient"><PatientCareChecklist /></ProtectedRoute>} />
            <Route path="/patient/second-opinion" element={<ProtectedRoute role="patient"><PatientSecondOpinion /></ProtectedRoute>} />
            <Route path="/patient/consent-vault" element={<ProtectedRoute role="patient"><PatientConsentVault /></ProtectedRoute>} />

            {/* Receptionist */}
            <Route path="/receptionist/dashboard" element={<ProtectedRoute role="receptionist"><ReceptionistDashboard /></ProtectedRoute>} />
            <Route path="/receptionist/appointments" element={<ProtectedRoute role="receptionist"><ReceptionistAppointments /></ProtectedRoute>} />
            <Route path="/receptionist/patients" element={<ProtectedRoute role="receptionist"><ReceptionistPatients /></ProtectedRoute>} />
            <Route path="/receptionist/billing" element={<ProtectedRoute role="receptionist"><ReceptionistBilling /></ProtectedRoute>} />
            <Route path="/receptionist/waitlist" element={<ProtectedRoute role="receptionist"><ReceptionistWaitlist /></ProtectedRoute>} />
            <Route path="/receptionist/queue" element={<ProtectedRoute role="receptionist"><ReceptionistQueue /></ProtectedRoute>} />
            <Route path="/receptionist/notifications" element={<ProtectedRoute role="receptionist"><ReceptionistBulkNotifications /></ProtectedRoute>} />
            <Route path="/receptionist/search" element={<ProtectedRoute role="receptionist"><SearchResults /></ProtectedRoute>} />
            <Route path="/receptionist/security" element={<ProtectedRoute role="receptionist"><SecuritySettings /></ProtectedRoute>} />
            <Route path="/receptionist/no-show-risk" element={<ProtectedRoute role="receptionist"><ReceptionistNoShowRisk /></ProtectedRoute>} />
            <Route path="/receptionist/reminder-escalations" element={<ProtectedRoute role="receptionist"><ReceptionistReminderEscalations /></ProtectedRoute>} />

            {/* Doctor */}
            <Route path="/doctor/dashboard" element={<ProtectedRoute role="doctor"><DoctorDashboard /></ProtectedRoute>} />
            <Route path="/doctor/appointments" element={<ProtectedRoute role="doctor"><DoctorAppointments /></ProtectedRoute>} />
            <Route path="/doctor/availability" element={<ProtectedRoute role="doctor"><DoctorAvailability /></ProtectedRoute>} />
            <Route path="/doctor/organizations" element={<ProtectedRoute role="doctor"><DoctorOrganizations /></ProtectedRoute>} />
            <Route path="/doctor/receptionists" element={<ProtectedRoute role="doctor"><DoctorReceptionists /></ProtectedRoute>} />
            <Route path="/doctor/queue" element={<ProtectedRoute role="doctor"><DoctorQueue /></ProtectedRoute>} />
            <Route path="/doctor/video-consultation/:appointmentId" element={<ProtectedRoute role="doctor"><DoctorVideoConsultation /></ProtectedRoute>} />
            <Route path="/doctor/note-templates" element={<ProtectedRoute role="doctor"><DoctorNoteTemplates /></ProtectedRoute>} />
            <Route path="/doctor/patient-history" element={<ProtectedRoute role="doctor"><DoctorPatientHistory /></ProtectedRoute>} />
            <Route path="/doctor/search" element={<ProtectedRoute role="doctor"><SearchResults /></ProtectedRoute>} />
            <Route path="/doctor/security" element={<ProtectedRoute role="doctor"><SecuritySettings /></ProtectedRoute>} />
            <Route path="/doctor/second-opinion-inbox" element={<ProtectedRoute role="doctor"><DoctorSecondOpinionInbox /></ProtectedRoute>} />

            {/* Admin */}
            <Route path="/admin/dashboard" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/applications" element={<ProtectedRoute role="admin"><AdminApplications /></ProtectedRoute>} />
            <Route path="/admin/applications/new" element={<ProtectedRoute role="admin"><AdminApplicationNew /></ProtectedRoute>} />
            <Route path="/admin/applications/:id" element={<ProtectedRoute role="admin"><AdminApplicationDetail /></ProtectedRoute>} />
            <Route path="/admin/doctors" element={<ProtectedRoute role="admin"><AdminDoctors /></ProtectedRoute>} />
            <Route path="/admin/doctors/:id" element={<ProtectedRoute role="admin"><AdminDoctorDetail /></ProtectedRoute>} />
            <Route path="/admin/clinics" element={<ProtectedRoute role="admin"><AdminClinics /></ProtectedRoute>} />
            <Route path="/admin/clinics/:id" element={<ProtectedRoute role="admin"><AdminClinicDetail /></ProtectedRoute>} />
            <Route path="/admin/receptionists" element={<ProtectedRoute role="admin"><AdminReceptionists /></ProtectedRoute>} />
            <Route path="/admin/waitlist" element={<ProtectedRoute role="admin"><AdminWaitlist /></ProtectedRoute>} />
            <Route path="/admin/analytics" element={<ProtectedRoute role="admin"><AdminAnalytics /></ProtectedRoute>} />
            <Route path="/admin/doctor-performance" element={<ProtectedRoute role="admin"><AdminDoctorPerformance /></ProtectedRoute>} />
            <Route path="/admin/document-expiry" element={<ProtectedRoute role="admin"><AdminDocumentExpiry /></ProtectedRoute>} />
            <Route path="/admin/audit-logs" element={<ProtectedRoute role="admin"><AdminAuditLogs /></ProtectedRoute>} />
            <Route path="/admin/alerts" element={<ProtectedRoute role="admin"><AdminAlertCenter /></ProtectedRoute>} />
            <Route path="/admin/ai-assistant" element={<ProtectedRoute role="admin"><AdminAIAssistant /></ProtectedRoute>} />
            <Route path="/admin/map" element={<ProtectedRoute role="admin"><AdminHealthcareMap /></ProtectedRoute>} />
            <Route path="/admin/forecast" element={<ProtectedRoute role="admin"><AdminForecast /></ProtectedRoute>} />
            <Route path="/admin/productivity" element={<ProtectedRoute role="admin"><AdminProductivity /></ProtectedRoute>} />
            <Route path="/admin/staff" element={<ProtectedRoute role="admin"><AdminStaffManagement /></ProtectedRoute>} />
            <Route path="/admin/permissions" element={<ProtectedRoute role="admin"><AdminPermissions /></ProtectedRoute>} />
            <Route path="/admin/search" element={<ProtectedRoute role="admin"><SearchResults /></ProtectedRoute>} />
            <Route path="/admin/security" element={<ProtectedRoute role="admin"><SecuritySettings /></ProtectedRoute>} />

            {/* Invalid login-style URLs (e.g. /manager/login) fall through to a proper 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        </LanguageProvider>
      </ToastProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}