from flask import Blueprint, request, jsonify, g

from app.utils.db import query, execute
from app.utils.auth import require_auth
from app.utils.helpers import gen_code, add_audit, add_notification
from app.utils.permissions import require_permission

bp = Blueprint("billing", __name__, url_prefix="/api")


@bp.post("/invoices")
@require_auth(["receptionist", "doctor"])
@require_permission("receptionist.manage_billing")
def create_invoice():
    """items: [{item_type, description, quantity, unit_price}], discount, tax_percent"""
    data = request.get_json(force=True) or {}
    required = ["appointment_id", "items"]
    if any(f not in data for f in required) or not data["items"]:
        return jsonify({"error": "appointment_id and items required"}), 400

    try:
        appointment_id = int(data["appointment_id"])
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid appointment ID"}), 400

    appt = query("SELECT * FROM appointments WHERE id=%s", (appointment_id,), fetchone=True)
    if not appt:
        return jsonify({"error": "Appointment not found"}), 404

    if g.role == "receptionist" and appt["clinic_id"] != g.clinic_id:
        return jsonify({"error": "Forbidden: appointment belongs to another clinic"}), 403
    if g.role == "doctor" and appt["doctor_id"] != g.profile_id:
        return jsonify({"error": "Forbidden: not your appointment"}), 403

    # ---- Authoritative consultation fee -------------------------------------
    # The consultation price is owned by the doctor attached to THIS appointment
    # (appointment.doctor_id -> doctors.consultation_fee). Whatever the client
    # sent for a consultation line item is ignored and overridden, so a
    # receptionist can never bill an arbitrary consultation amount. Other line
    # items (medicine, lab, other) are preserved exactly as entered.
    doctor = query("SELECT id, full_name, consultation_fee FROM doctors WHERE id=%s",
                   (appt["doctor_id"],), fetchone=True)
    if not doctor:
        return jsonify({"error": "Doctor for this appointment not found"}), 404
    if doctor["consultation_fee"] is None:
        return jsonify({"error": "This doctor has not configured a consultation fee yet"}), 400
    doctor_fee = round(float(doctor["consultation_fee"]), 2)
    if doctor_fee < 0:
        return jsonify({"error": "Doctor consultation fee is invalid"}), 400

    normalized_items = []
    for raw in data["items"]:
        item_type = (raw.get("item_type") or "other").strip().lower()
        try:
            quantity = int(raw.get("quantity", 1) or 1)
        except (TypeError, ValueError):
            return jsonify({"error": "Quantity must be a whole number"}), 400
        if quantity < 1:
            return jsonify({"error": "Quantity must be at least 1"}), 400

        if item_type == "consultation":
            # Override with the doctor's configured fee, and force qty 1 so the
            # consultation can't be multiplied into an arbitrary amount.
            unit_price = doctor_fee
            quantity = 1
            description = raw.get("description") or "Consultation Fee"
        else:
            try:
                unit_price = round(float(raw.get("unit_price") or 0), 2)
            except (TypeError, ValueError):
                return jsonify({"error": "Unit price must be a valid number"}), 400
            if unit_price < 0:
                return jsonify({"error": "Unit price cannot be negative"}), 400
            description = raw.get("description", "")

        normalized_items.append({
            "item_type": item_type,
            "description": description,
            "quantity": quantity,
            "unit_price": unit_price,
        })

    # Ensure exactly one consultation line exists for the appointment.
    consultation_lines = [i for i in normalized_items if i["item_type"] == "consultation"]
    if not consultation_lines:
        normalized_items.insert(0, {
            "item_type": "consultation", "description": "Consultation Fee",
            "quantity": 1, "unit_price": doctor_fee,
        })
    elif len(consultation_lines) > 1:
        keep = consultation_lines[0]
        normalized_items = [i for i in normalized_items
                            if i["item_type"] != "consultation" or i is keep]

    data["items"] = normalized_items

    subtotal = sum(float(i["unit_price"]) * int(i.get("quantity", 1)) for i in data["items"])
    subtotal = round(subtotal, 2)
    try:
        discount = round(float(data.get("discount") or 0), 2)
        tax_percent = float(data.get("tax_percent") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "Discount and tax must be valid numbers"}), 400
    if discount < 0 or tax_percent < 0:
        return jsonify({"error": "Discount and tax cannot be negative"}), 400
    if discount > subtotal:
        return jsonify({"error": "Discount cannot exceed the subtotal"}), 400
    taxable = max(subtotal - discount, 0)
    tax_gst = round(taxable * tax_percent / 100, 2)
    total = round(taxable + tax_gst, 2)

    invoice_number = gen_code("INV", 8)
    invoice_id = execute(
        """INSERT INTO invoices (invoice_number, appointment_id, patient_id, clinic_id,
           subtotal, discount, tax_gst, total_amount, payment_status)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'Pending')""",
        (invoice_number, appt["id"], appt["patient_id"], appt["clinic_id"],
         subtotal, discount, tax_gst, total),
    )
    for item in data["items"]:
        line_total = float(item["unit_price"]) * int(item.get("quantity", 1))
        execute(
            """INSERT INTO invoice_items (invoice_id, item_type, description, quantity, unit_price, line_total)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (invoice_id, item["item_type"], item.get("description", ""),
             item.get("quantity", 1), item["unit_price"], line_total),
        )
    add_audit(g.user_id, g.role, "INVOICE_GENERATED", invoice_number)
    return jsonify({"invoice_id": invoice_id, "invoice_number": invoice_number, "total_amount": total}), 201


@bp.get("/invoices/<int:invoice_id>")
@require_auth(["patient", "receptionist", "doctor"])
def get_invoice(invoice_id):
    inv = query(
        """SELECT i.*, p.full_name AS patient_name, p.patient_code, c.name AS clinic_name,
                  c.address AS clinic_address, c.contact_number AS clinic_phone, c.email AS clinic_email,
                  a.appointment_date, a.appointment_time, d.full_name AS doctor_name
           FROM invoices i
           JOIN patients p ON p.id = i.patient_id
           JOIN clinics c ON c.id = i.clinic_id
           JOIN appointments a ON a.id = i.appointment_id
           JOIN doctors d ON d.id = a.doctor_id
           WHERE i.id=%s""",
        (invoice_id,), fetchone=True,
    )
    if not inv:
        return jsonify({"error": "Not found"}), 404
    if g.role == "patient" and inv["patient_id"] != g.profile_id:
        return jsonify({"error": "Forbidden"}), 403
    inv["items"] = query("SELECT * FROM invoice_items WHERE invoice_id=%s", (invoice_id,))
    inv["payments"] = query("SELECT * FROM payments WHERE invoice_id=%s ORDER BY transaction_date", (invoice_id,))
    inv["insurance"] = query(
        "SELECT * FROM insurance_profiles WHERE patient_id=%s AND is_active=1 ORDER BY is_primary DESC",
        (inv["patient_id"],),
    )
    return jsonify(inv)


@bp.get("/patients/invoices")
@require_auth(["patient"])
def my_invoices():
    return jsonify(query(
        """SELECT i.*, c.name AS clinic_name FROM invoices i JOIN clinics c ON c.id=i.clinic_id
           WHERE i.patient_id=%s ORDER BY i.created_at DESC""",
        (g.profile_id,),
    ))


@bp.post("/payments")
@require_auth(["receptionist"])
def record_payment():
    data = request.get_json(force=True) or {}
    required = ["invoice_id", "amount", "method"]
    if any(f not in data for f in required):
        return jsonify({"error": "invoice_id, amount, method required"}), 400

    invoice = query("SELECT * FROM invoices WHERE id=%s", (data["invoice_id"],), fetchone=True)
    if not invoice:
        return jsonify({"error": "Invoice not found"}), 404

    payment_code = gen_code("PAY", 8)
    already_paid = query(
        "SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id=%s AND status='Paid'",
        (data["invoice_id"],), fetchone=True,
    )["paid"]
    new_total_paid = float(already_paid) + float(data["amount"])
    new_status = "Paid" if new_total_paid >= float(invoice["total_amount"]) else "Partially Paid"

    payment_id = execute(
        """INSERT INTO payments (payment_id, invoice_id, amount, method, status)
           VALUES (%s,%s,%s,%s,'Paid')""",
        (payment_code, data["invoice_id"], data["amount"], data["method"]),
    )
    execute("UPDATE invoices SET payment_status=%s WHERE id=%s", (new_status, data["invoice_id"]))

    patient_user = query(
        "SELECT u.id FROM patients p JOIN users u ON u.id=p.user_id WHERE p.id=%s",
        (invoice["patient_id"],), fetchone=True,
    )
    add_notification(patient_user["id"], "payment_recorded", "Payment Recorded",
                      f"Payment of Rs.{data['amount']} recorded for invoice {invoice['invoice_number']}.")
    add_audit(g.user_id, "receptionist", "PAYMENT_RECORDED", payment_code)
    return jsonify({"payment_id": payment_id, "payment_code": payment_code, "invoice_status": new_status}), 201


@bp.get("/payments")
@require_auth(["receptionist", "patient"])
def list_payments():
    if g.role == "patient":
        rows = query(
            """SELECT pay.* , i.invoice_number FROM payments pay
               JOIN invoices i ON i.id = pay.invoice_id WHERE i.patient_id=%s
               ORDER BY pay.transaction_date DESC""",
            (g.profile_id,),
        )
    else:
        rows = query(
            """SELECT pay.*, i.invoice_number, p.full_name AS patient_name FROM payments pay
               JOIN invoices i ON i.id = pay.invoice_id JOIN patients p ON p.id = i.patient_id
               ORDER BY pay.transaction_date DESC""",
        )
    return jsonify(rows)


@bp.get("/receipts/<int:invoice_id>")
@require_auth(["patient", "receptionist", "doctor"])
def printable_receipt(invoice_id):
    """Structured data for the frontend printable A4 receipt component."""
    return get_invoice(invoice_id)