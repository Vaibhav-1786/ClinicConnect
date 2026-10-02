import React, { createContext, useContext, useState, useCallback } from "react";
import api from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(sessionStorage.getItem("token"));
  const [role, setRole] = useState(sessionStorage.getItem("role"));
  const [profile, setProfile] = useState(() => {
    const raw = sessionStorage.getItem("profile");
    return raw ? JSON.parse(raw) : null;
  });
  // Doctor / Receptionist sessions are scoped to a clinic/hospital. Patients
  // and Admins leave this null.
  const [clinic, setClinic] = useState(() => {
    const raw = sessionStorage.getItem("clinic");
    return raw ? JSON.parse(raw) : null;
  });
  const [organizations, setOrganizations] = useState(() => {
    const raw = sessionStorage.getItem("organizations");
    return raw ? JSON.parse(raw) : [];
  });

  const login = useCallback((newRole, newToken, profileData, clinicData, orgs) => {
    sessionStorage.setItem("token", newToken);
    sessionStorage.setItem("role", newRole);
    sessionStorage.setItem("profile", JSON.stringify(profileData || {}));
    sessionStorage.setItem("clinic", JSON.stringify(clinicData || null));
    sessionStorage.setItem("organizations", JSON.stringify(orgs || []));
    setToken(newToken);
    setRole(newRole);
    setProfile(profileData || {});
    setClinic(clinicData || null);
    setOrganizations(orgs || []);
  }, []);

  // Switch the doctor's active clinic/hospital WITHOUT logging out: swap the
  // token (it carries the new clinic_id claim) and update clinic context only.
  const switchClinic = useCallback((newToken, clinicData) => {
    sessionStorage.setItem("token", newToken);
    sessionStorage.setItem("clinic", JSON.stringify(clinicData || null));
    setToken(newToken);
    setClinic(clinicData || null);
  }, []);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch (e) { /* ignore */ }
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("role");
    sessionStorage.removeItem("profile");
    sessionStorage.removeItem("clinic");
    sessionStorage.removeItem("organizations");
    setToken(null);
    setRole(null);
    setProfile(null);
    setClinic(null);
    setOrganizations([]);
  }, []);

  return (
    <AuthContext.Provider value={{ token, role, profile, clinic, organizations, login, logout, switchClinic }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}