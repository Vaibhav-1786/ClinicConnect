import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import DashboardLayout from "../../layouts/DashboardLayout";
import VideoCallRoom from "../../components/VideoCallRoom";
import ConsultationNotesPanel from "../../components/ConsultationNotesPanel";
import { useLanguage } from "../../context/LanguageContext";

export default function VideoConsultation() {
  const { appointmentId } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <DashboardLayout title={t("nav.videoConsultation")}>
      <div className="card">
        <button className="btn small secondary" style={{ marginBottom: 12 }} onClick={() => navigate("/doctor/appointments")}>
          ← {t("docVideo.backToAppointments")}
        </button>
        <VideoCallRoom role="doctor" appointmentId={appointmentId} />
      </div>
      <ConsultationNotesPanel appointmentId={appointmentId} />
    </DashboardLayout>
  );
}
