import React, { useState, useEffect, useRef, useCallback } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import { useToast } from "../context/ToastContext";
import ThemeToggle from "../components/ThemeToggle";
import GlobalSearch from "../components/GlobalSearch";
import LanguageSelector from "../components/LanguageSelector";
import OfflineBanner from "../components/OfflineBanner";
import AIChatAssistant from "../components/AIChatAssistant";
import SOSButton from "../components/SOSButton";
import NotificationBell from "../components/NotificationBell";
import { useLanguage } from "../context/LanguageContext";

const NAV = {
  patient: [
    ["nav.dashboard", "/patient/dashboard"],
    ["nav.findSpecialist", "/patient/find-specialist"],
    ["nav.findClinic", "/patient/clinics"],
    ["nav.myAppointments", "/patient/appointments"],
    ["nav.videoConsultation", "/patient/video-consultation"],
    ["nav.recurringAppointments", "/patient/recurring-appointments"],
    ["nav.waitlist", "/patient/waitlist"],
    ["nav.family", "/patient/family"],
    ["nav.healthTimeline", "/patient/health-timeline"],
    ["nav.medicineReminders", "/patient/medicine-reminders"],
    ["nav.insurance", "/patient/insurance"],
    ["nav.prescriptions", "/patient/prescriptions"],
    ["nav.payments", "/patient/payments"],
    ["nav.careChecklist", "/patient/care-checklist"],
    ["nav.secondOpinion", "/patient/second-opinion"],
    ["nav.consentVault", "/patient/consent-vault"],
    ["nav.profile", "/patient/profile"],
    ["nav.security", "/patient/security"],
  ],
  receptionist: [
    ["nav.dashboard", "/receptionist/dashboard"],
    ["nav.appointmentRequests", "/receptionist/appointments"],
    ["nav.queue", "/receptionist/queue"],
    ["nav.waitlist", "/receptionist/waitlist"],
    ["nav.noShowRisk", "/receptionist/no-show-risk"],
    ["nav.reminderEscalations", "/receptionist/reminder-escalations"],
    ["nav.bulkNotifications", "/receptionist/notifications"],
    ["nav.patients", "/receptionist/patients"],
    ["nav.billing", "/receptionist/billing"],
    ["nav.security", "/receptionist/security"],
  ],
  doctor: [
    ["nav.dashboard", "/doctor/dashboard"],
    ["nav.switchOrganization", "/doctor/organizations"],
    ["nav.appointments", "/doctor/appointments"],
    ["nav.todaysQueue", "/doctor/queue"],
    ["nav.patientHistory", "/doctor/patient-history"],
    ["nav.secondOpinionInbox", "/doctor/second-opinion-inbox"],
    ["nav.noteTemplates", "/doctor/note-templates"],
    ["nav.availability", "/doctor/availability"],
    ["nav.receptionists", "/doctor/receptionists"],
    ["nav.security", "/doctor/security"],
  ],
  admin: [
    ["nav.dashboard", "/admin/dashboard"],
    ["nav.alerts", "/admin/alerts"],
    ["nav.aiAssistant", "/admin/ai-assistant"],
    ["nav.healthcareMap", "/admin/map"],
    ["nav.analytics", "/admin/analytics"],
    ["nav.doctorPerformance", "/admin/doctor-performance"],
    ["nav.doctorApplications", "/admin/applications"],
    ["nav.doctors", "/admin/doctors"],
    ["nav.documentExpiry", "/admin/document-expiry"],
    ["nav.clinics", "/admin/clinics"],
    ["nav.receptionists", "/admin/receptionists"],
    ["nav.staffManagement", "/admin/staff"],
    ["nav.permissions", "/admin/permissions"],
    ["nav.waitlistMonitor", "/admin/waitlist"],
    ["nav.forecast", "/admin/forecast"],
    ["nav.productivity", "/admin/productivity"],
    ["nav.auditLogs", "/admin/audit-logs"],
    ["nav.security", "/admin/security"],
  ],
};

function OrgBadge() {
  const { clinic } = useAuth();
  if (!clinic) return null;
  return (
    <span className="pill org-badge" title={clinic.clinic_code}>
      {clinic.name} · {clinic.clinic_code}
    </span>
  );
}

/** Quick-switch dropdown shown only for doctors with more than one organization. */
function OrgSwitcher() {
  const { role, clinic, organizations, switchClinic } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  if (role !== "doctor" || !organizations || organizations.length < 2) return null;

  const onChange = async (e) => {
    const newClinicId = Number(e.target.value);
    if (!newClinicId || newClinicId === clinic?.id) return;
    setBusy(true);
    try {
      const res = await api.post("/doctor/switch-organization", { clinic_id: newClinicId });
      switchClinic(res.data.token, res.data.clinic);
      showToast(`Switched to ${res.data.clinic.name}`, "success");
      // Clinic-scoped views (appointments, patients, availability, etc.) all
      // read from the new token on their next fetch — no logout required.
      window.location.reload();
    } catch (err) {
      showToast(err.response?.data?.error || "Could not switch organization", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <select className="input org-switcher" style={{ margin: 0 }} aria-label="Switch clinic or hospital" value={clinic?.id || ""} onChange={onChange} disabled={busy}>
      {organizations.map((org) => (
        <option key={org.id} value={org.id}>{org.name} ({org.clinic_code})</option>
      ))}
    </select>
  );
}

// Below this width the sidebar becomes an off-canvas drawer (see styles.css).
// Keep in sync with the `--bp-drawer` breakpoint used in the stylesheet.
const DRAWER_MEDIA = "(max-width: 991.98px)";

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function DashboardLayout({ title, children }) {
  const { role, profile, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const items = NAV[role] || [];

  const [navOpen, setNavOpen] = useState(false);
  const toggleRef = useRef(null);
  const closeRef = useRef(null);

  const closeNav = useCallback((returnFocus = false) => {
    setNavOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  // Close the drawer whenever the route changes (i.e. after tapping a link).
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  // While the drawer is open: Esc closes it, page scroll is locked, focus moves into it.
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") closeNav(true); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [navOpen, closeNav]);

  // If the window grows past the drawer breakpoint (resize / rotate), reset the drawer state.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(DRAWER_MEDIA);
    const onChange = (e) => { if (!e.matches) setNavOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate(`/${role}/login`);
  };

  return (
    <div className={`app-shell role-${role}`}>
      <div className="mobile-bar no-print">
        <button
          type="button"
          ref={toggleRef}
          className="nav-toggle"
          onClick={() => setNavOpen(true)}
          aria-label={t("nav.openMenu", "Open menu")}
          aria-expanded={navOpen}
          aria-controls="app-sidebar"
        >
          <MenuIcon />
        </button>
        <span className="mobile-bar-brand">🏥 ClinicConnect</span>
      </div>

      <div
        className={`sidebar-backdrop no-print${navOpen ? " open" : ""}`}
        onClick={() => closeNav(true)}
        aria-hidden="true"
      />

      <aside id="app-sidebar" className={`sidebar no-print${navOpen ? " open" : ""}`}>
        <div className="brand">
          <span className="brand-text">🏥 ClinicConnect</span>
          <button
            type="button"
            ref={closeRef}
            className="nav-close"
            onClick={() => closeNav(true)}
            aria-label={t("nav.closeMenu", "Close menu")}
          >
            <CloseIcon />
          </button>
        </div>
        <nav aria-label={t("nav.mainNavigation", "Main navigation")}>
          {items.map(([labelKey, path]) => (
            <NavLink key={path} to={path} className={({ isActive }) => (isActive ? "active" : "")}>
              {t(labelKey)}
            </NavLink>
          ))}
          <button type="button" className="nav-link-btn" onClick={handleLogout}>{t("nav.logout")}</button>
        </nav>
      </aside>

      <main className="main-content">
        <OfflineBanner />
        <div className="topbar">
          <h1>{title}</h1>
          <div className="topbar-tools">
            <GlobalSearch />
            {profile?.full_name ? <span className="topbar-greeting">{`Hi, ${profile.full_name}`}</span> : null}
            <span className="pill">{role}</span>
            {(role === "doctor" || role === "receptionist") && <OrgBadge />}
            <OrgSwitcher />
            <NotificationBell />
            <LanguageSelector />
            <ThemeToggle compact />
          </div>
        </div>
        {children}
      </main>
      {role === "patient" && <AIChatAssistant />}
      {role === "patient" && <SOSButton />}
    </div>
  );
}
