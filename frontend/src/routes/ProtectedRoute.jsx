import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ role, children }) {
  const { token, role: currentRole } = useAuth();

  if (!token) {
    return <Navigate to={`/${role}/login`} replace />;
  }
  if (currentRole !== role) {
    // A patient/receptionist/doctor must never access another role's pages
    return <Navigate to={`/${currentRole}/dashboard`} replace />;
  }
  return children;
}
