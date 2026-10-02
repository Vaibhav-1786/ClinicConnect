import React from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import RecoveryPageShell from "../../components/recovery/RecoveryPageShell";
import ForgotPasswordForm from "../../components/recovery/ForgotPasswordForm";

export default function ReceptionistForgotPassword() {
  const { t } = useLanguage();
  return (
    <RecoveryPageShell title={t("forgotPassword.receptionistTitle")}>
      <ForgotPasswordForm
        loginPath="/receptionist/login"
        extraLinks={
          <p style={{ fontSize: 13, marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            <Link to="/receptionist/forgot-id">{t("login.forgotReceptionistId")}</Link>
            <Link to="/receptionist/forgot-clinic-id">{t("login.forgotClinicId")}</Link>
          </p>
        }
      />
    </RecoveryPageShell>
  );
}
