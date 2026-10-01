from flask import Flask, jsonify
from flask_cors import CORS

from config import Config


def create_app():
    app = Flask(__name__)
    CORS(app, resources={r"/api/*": {"origins": Config.CORS_ORIGIN}}, supports_credentials=True)

    from app.routes import auth, locations, clinics, availability, appointments
    from app.routes import medicines, prescriptions, billing, notifications, messages
    from app.routes import clinical, profiles, reports
    from app.routes import admin, doctor_org, ai
    from app.routes import family, recurring, waitlist
    from app.routes import insurance, reminders, health_timeline
    from app.routes import bulk_notifications, search
    from app.routes import doctor_notes
    from app.routes import admin_analytics
    from app.routes import two_factor
    from app.routes import specialist_routing
    from app.routes import video_consultation
    from app.routes import care_checklist, second_opinion, consent_vault, sos, reminder_escalation
    from app.routes import admin_matching, admin_scoring, admin_workflow, admin_alerts, ai_admin
    from app.routes import public_profiles
    from app.routes import patient_journey, patient_360, triage, dashboard_prefs
    from app.routes import permissions_admin, staff
    from app.routes import patient_hospitals, receptionist_access

    for bp in [
        auth.bp, locations.bp, clinics.bp, availability.bp, appointments.bp,
        medicines.bp, prescriptions.bp, billing.bp, notifications.bp, messages.bp,
        clinical.bp, profiles.bp, reports.bp,
        admin.bp, doctor_org.bp, ai.bp,
        family.bp, recurring.bp, waitlist.bp,
        insurance.bp, reminders.bp, health_timeline.bp,
        bulk_notifications.bp, search.bp,
        doctor_notes.bp,
        admin_analytics.bp,
        two_factor.bp,
        specialist_routing.bp,
        video_consultation.bp,
        care_checklist.bp, second_opinion.bp, consent_vault.bp, sos.bp, reminder_escalation.bp,
        admin_matching.bp, admin_scoring.bp, admin_workflow.bp, admin_alerts.bp, ai_admin.bp,
        public_profiles.bp,
        patient_journey.bp, patient_360.bp, triage.bp, dashboard_prefs.bp,
        permissions_admin.bp, staff.bp,
        patient_hospitals.bp, receptionist_access.bp,
    ]:
        app.register_blueprint(bp)

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.errorhandler(400)
    def bad_request(e):
        return jsonify({"error": "Bad request", "detail": str(e)}), 400

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(405)
    def method_not_allowed(e):
        return jsonify({"error": "Method not allowed"}), 405

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({"error": "Internal server error"}), 500

    return app
