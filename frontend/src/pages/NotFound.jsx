import React from "react";
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="auth-page">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <h2>404</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: 20 }}>
          This page doesn't exist.
        </p>
        <Link className="btn" to="/login">Go to Login</Link>
      </div>
    </div>
  );
}
