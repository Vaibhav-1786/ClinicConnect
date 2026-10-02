import React from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import RecoveryPageShell from "../../components/recovery/RecoveryPageShell";
import ForgotPasswordForm from "../../components/recovery/ForgotPasswordForm";

export default function DoctorForgotPassword() {
  const { t } = useLanguage();
  return (
    <RecoveryPageShell title={t("forgotPassword.doctorTitle")}>
      <ForgotPasswordForm
        loginPath="/doctor/login"
        extraLinks={
          <p style={{ fontSize: 13, marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            <Link to="/doctor/forgot-id">{t("login.forgotDoctorId")}</Link>
            <Link to="/doctor/forgot-clinic-id">{t("login.forgotClinicId")}</Link>
          </p>
        }
      />
    </RecoveryPageShell>
  );
}
