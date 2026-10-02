import React from "react";
import { useAuth } from "../context/AuthContext";
import useOnlineStatus from "../hooks/useOnlineStatus";
import { useLanguage } from "../context/LanguageContext";

export default function OfflineBanner() {
  const online = useOnlineStatus();
  const { role } = useAuth();
  const { t } = useLanguage();

  if (online) return null;

  return (
    <div style={{
      background: "var(--danger-soft-text)", color: "white", padding: "8px 16px", fontSize: 13,
      textAlign: "center", position: "sticky", top: 0, zIndex: 50,
    }}>
      {t("offline.youAreOffline")}{" "}
      {role === "receptionist" ? t("offline.receptionistHint") : t("offline.genericHint")}
    </div>
  );
}
