import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import VideoCallRoom from "../../components/VideoCallRoom";
import { useLanguage } from "../../context/LanguageContext";

export default function VideoConsultation() {
  const { appointmentId } = useParams();
  const [onlineAppointments, setOnlineAppointments] = useState([]);
  const [selectedId, setSelectedId] = useState(appointmentId || "");
  const { t } = useLanguage();

  useEffect(() => {
    api.get("/appointments/patient").then((r) => {
      const online = (r.data.appointments || []).filter(
        (a) => a.consultation_mode === "ONLINE" && !["CANCELLED", "NO_SHOW", "COMPLETED"].includes(a.status)
      );
      setOnlineAppointments(online);
      if (!appointmentId && online.length === 1) setSelectedId(String(online[0].id));
    });
  }, [appointmentId]);

  return (
    <DashboardLayout title={t("nav.videoConsultation")}>
      {!selectedId ? (
        <div className="card">
          <h3>{t("patVideo.yourOnlineAppointments")}</h3>
          {onlineAppointments.length === 0 ? (
            <div className="empty-state">{t("patVideo.empty")}</div>
          ) : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("dashboard.doctor")}</th><th>{t("common.date")}</th><th>{t("common.time")}</th><th>{t("common.status")}</th><th></th></tr></thead>
              <tbody>
                {onlineAppointments.map((a) => (
                  <tr key={a.id}>
                    <td>Dr. {a.doctor_name}</td>
                    <td>{a.appointment_date}</td>
                    <td>{String(a.appointment_time).slice(0,5)}</td>
                    <td><span className="badge CONFIRMED">{a.status}</span></td>
                    <td><button className="btn small" onClick={() => setSelectedId(String(a.id))}>{t("patVideo.open")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      ) : (
        <div className="card">
          <button className="btn small secondary" style={{ marginBottom: 12 }} onClick={() => setSelectedId("")}>← {t("patVideo.backToList")}</button>
          <VideoCallRoom role="patient" appointmentId={selectedId} />
        </div>
      )}
    </DashboardLayout>
  );
}
