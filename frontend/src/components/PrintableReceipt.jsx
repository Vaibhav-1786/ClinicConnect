import React from "react";

export default function PrintableReceipt({ invoice, prescription }) {
  if (!invoice) return null;
  return (
    <div>
      <div className="no-print" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => window.print()}>🖨️ Print Receipt</button>
      </div>
      <div className="receipt">
        <h2>{invoice.clinic_name}</h2>
        <p className="center">{invoice.clinic_address}<br/>Phone: {invoice.clinic_phone} · {invoice.clinic_email}</p>
        <hr />
        <h3 className="center">PRESCRIPTION / MEDICINE RECEIPT</h3>
        <div className="table-wrap"><table style={{ width: "100%" }}>
          <tbody>
            <tr><td>Receipt No:</td><td>{invoice.invoice_number}</td><td>Date:</td><td>{invoice.created_at?.slice(0,10)}</td></tr>
            <tr><td>Patient Name:</td><td>{invoice.patient_name}</td><td>Patient ID:</td><td>{invoice.patient_code}</td></tr>
            <tr><td>Doctor:</td><td>Dr. {invoice.doctor_name}</td><td>Appointment ID:</td><td>{invoice.appointment_id}</td></tr>
          </tbody>
        </table></div>
        <hr />
        {prescription && prescription.items && prescription.items.length > 0 && (
          <>
            <div className="table-wrap"><table style={{ width: "100%" }}>
              <thead>
                <tr><th>Medicine</th><th>Qty</th><th>Dosage</th><th>Frequency</th><th>Duration</th></tr>
              </thead>
              <tbody>
                {prescription.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.medicine_name}</td><td>{it.quantity}</td><td>{it.dosage}</td>
                    <td>{it.frequency}</td><td>{it.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <hr />
          </>
        )}
        <div className="table-wrap"><table style={{ width: "100%" }}>
          <tbody>
            {invoice.items?.map((it) => (
              <tr key={it.id}><td>{it.description}</td><td>x{it.quantity}</td><td>₹{it.unit_price}</td><td>₹{it.line_total}</td></tr>
            ))}
          </tbody>
        </table></div>
        <hr />
        <div className="table-wrap"><table style={{ width: "100%" }}>
          <tbody>
            <tr><td>Subtotal</td><td style={{ textAlign: "right" }}>₹{invoice.subtotal}</td></tr>
            <tr><td>Discount</td><td style={{ textAlign: "right" }}>₹{invoice.discount}</td></tr>
            <tr><td>Tax/GST</td><td style={{ textAlign: "right" }}>₹{invoice.tax_gst}</td></tr>
            <tr><td><strong>Total Amount</strong></td><td style={{ textAlign: "right" }}><strong>₹{invoice.total_amount}</strong></td></tr>
            <tr><td>Payment Status</td><td style={{ textAlign: "right" }}>{invoice.payment_status}</td></tr>
          </tbody>
        </table></div>
        <hr />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40 }}>
          <div>_____________________<br/>Doctor Signature</div>
          <div>_____________________<br/>Clinic Stamp/Signature</div>
        </div>
      </div>
    </div>
  );
}
