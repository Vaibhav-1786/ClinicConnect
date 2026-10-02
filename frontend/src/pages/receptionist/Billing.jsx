import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";

const consultationItem = (unitPrice) => ({
  item_type: "consultation",
  description: "Consultation Fee",
  quantity: 1,
  unit_price: unitPrice,
  locked: true, // price is owned by the doctor, not the receptionist
});

export default function ReceptionistBilling() {
  const [appointmentId, setAppointmentId] = useState("");
  const [apptInfo, setApptInfo] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [items, setItems] = useState([consultationItem("")]);
  const [discount, setDiscount] = useState(0);
  const [taxPercent, setTaxPercent] = useState(5);
  const [invoice, setInvoice] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const { showToast } = useToast();
  const { t } = useLanguage();

  // When the receptionist enters an Appointment ID, load the appointment, its
  // doctor, and that doctor's CURRENT consultation fee, then auto-populate the
  // consultation line item. The fee is never typed in by hand.
  useEffect(() => {
    const raw = String(appointmentId).trim();
    if (raw === "") {
      setApptInfo(null);
      setLookupError("");
      setItems((prev) => prev.map((i) => (i.item_type === "consultation" ? consultationItem("") : i)));
      return;
    }
    if (!/^\d+$/.test(raw)) {
      setApptInfo(null);
      setLookupError(t("recBilling.invalidApptId", "Appointment ID must be a number"));
      return;
    }

    let cancelled = false;
    setLookupLoading(true);
    setLookupError("");
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/appointments/${raw}/billing-info`);
        if (cancelled) return;
        const info = res.data;
        setApptInfo(info);
        if (info.consultation_fee_missing) {
          setLookupError(t("recBilling.feeMissing", "This doctor has not configured a consultation fee yet."));
        }
        const fee = Number(info.consultation_fee ?? 0);
        setItems((prev) => {
          const others = prev.filter((i) => i.item_type !== "consultation");
          return [consultationItem(fee), ...others];
        });
      } catch (err) {
        if (cancelled) return;
        setApptInfo(null);
        setItems((prev) => prev.map((i) => (i.item_type === "consultation" ? consultationItem("") : i)));
        const status = err.response?.status;
        setLookupError(
          err.response?.data?.error ||
            (status === 404
              ? t("recBilling.apptNotFound", "Appointment not found")
              : t("recBilling.lookupFailed", "Could not load appointment details"))
        );
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    }, 400); // debounce while typing

    return () => { cancelled = true; clearTimeout(timer); setLookupLoading(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId]);

  const updateItem = (idx, field, value) => {
    const next = [...items];
    // The consultation line is controlled by the doctor's configured fee.
    if (next[idx].locked && (field === "unit_price" || field === "item_type" || field === "quantity")) return;
    next[idx] = { ...next[idx], [field]: value };
    setItems(next);
  };
  const addItem = () => setItems([...items, { item_type: "medicine", description: "", quantity: 1, unit_price: "" }]);
  const removeItem = (idx) => {
    if (items[idx]?.locked) return; // consultation line cannot be removed
    setItems(items.filter((_, i) => i !== idx));
  };

  const subtotalPreview = items.reduce(
    (sum, i) => sum + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0), 0
  );
  const discountPreview = Math.min(Number(discount) || 0, subtotalPreview);
  const taxPreview = Math.max(subtotalPreview - discountPreview, 0) * (Number(taxPercent) || 0) / 100;
  const totalPreview = Math.max(subtotalPreview - discountPreview, 0) + taxPreview;

  const generateInvoice = async () => {
    if (!apptInfo) {
      showToast(t("recBilling.needAppointment", "Enter a valid Appointment ID first"), "error");
      return;
    }
    try {
      const res = await api.post("/invoices", {
        appointment_id: Number(appointmentId),
        // Send the consultation line plus any manually added items. The backend
        // re-derives the consultation price from the doctor regardless.
        items: items
          .filter((i) => i.item_type === "consultation" || i.unit_price !== "")
          .map(({ item_type, description, quantity, unit_price }) => ({
            item_type, description, quantity, unit_price,
          })),
        discount: Number(discount),
        tax_percent: Number(taxPercent),
      });
      showToast(t("recBilling.invoiceGenerated").replace("{number}", res.data.invoice_number).replace("{total}", res.data.total_amount), "success");
      const full = await api.get(`/invoices/${res.data.invoice_id}`);
      setInvoice(full.data);
    } catch (err) {
      showToast(err.response?.data?.error || t("recBilling.generateFailed"), "error");
    }
  };

  const recordPayment = async () => {
    try {
      const res = await api.post("/payments", {
        invoice_id: invoice.id, amount: Number(paymentAmount), method: paymentMethod,
      });
      showToast(t("recBilling.paymentRecorded").replace("{status}", res.data.invoice_status), "success");
      const full = await api.get(`/invoices/${invoice.id}`);
      setInvoice(full.data);
      setPaymentAmount("");
    } catch (err) {
      showToast(err.response?.data?.error || t("recBilling.paymentFailed"), "error");
    }
  };

  return (
    <DashboardLayout title={t("nav.billing")}>
      <div className="card">
        <h3>{t("recBilling.generateInvoice")}</h3>
        <label>{t("recBilling.appointmentId")}</label>
        <input className="input" value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)} placeholder="e.g. 12" />

        {lookupLoading && (
          <p style={{ color: "var(--text-muted)", marginTop: 8 }}>
            {t("recBilling.loadingAppointment", "Loading appointment\u2026")}
          </p>
        )}
        {lookupError && !lookupLoading && (
          <p style={{ color: "var(--danger, #dc2626)", marginTop: 8 }}>{lookupError}</p>
        )}
        {apptInfo && !lookupLoading && (
          <div style={{ background: "var(--bg-subtle, #f8fafc)", borderRadius: 8, padding: "10px 14px", margin: "10px 0" }}>
            <p style={{ margin: "4px 0" }}>
              {t("docQueue.patient")}: <strong>{apptInfo.patient_name}</strong> ({apptInfo.patient_code})
            </p>
            <p style={{ margin: "4px 0" }}>
              {t("dashboard.doctor")}: <strong>Dr. {apptInfo.doctor_name}</strong>
              {apptInfo.specialization ? ` \u00b7 ${apptInfo.specialization}` : ""}
            </p>
            <p style={{ margin: "4px 0" }}>
              {t("dashboard.clinic")}: {apptInfo.clinic_name}
            </p>
            <p style={{ margin: "4px 0" }}>
              {t("patFindSpecialist.fee")}: <strong>₹{Number(apptInfo.consultation_fee).toFixed(2)}</strong>
            </p>
          </div>
        )}

        {items.map((it, idx) => (
          <div className="bill-row" key={idx}>
            <div>
              <label>{t("docQueue.type")}</label>
              <select value={it.item_type} disabled={it.locked} onChange={(e) => updateItem(idx, "item_type", e.target.value)}>
                <option value="consultation">{t("recBilling.consultation")}</option>
                <option value="medicine">{t("recBilling.medicine")}</option>
                <option value="lab">{t("recBilling.lab")}</option>
                <option value="other">{t("patFamily.other")}</option>
              </select>
            </div>
            <div><label>{t("recBilling.description")}</label><input className="input" value={it.description} onChange={(e) => updateItem(idx, "description", e.target.value)} /></div>
            <div><label>{t("recBilling.qty")}</label><input className="input" type="number" min="1" value={it.quantity} readOnly={it.locked} disabled={it.locked} onChange={(e) => updateItem(idx, "quantity", e.target.value)} /></div>
            <div>
              <label>{t("recBilling.unit")} ₹</label>
              <input
                className="input"
                type="number"
                value={it.unit_price}
                readOnly={it.locked}
                disabled={it.locked}
                title={it.locked ? t("recBilling.feeLocked", "Set by the doctor's consultation fee") : undefined}
                onChange={(e) => updateItem(idx, "unit_price", e.target.value)}
              />
            </div>
            {it.locked ? (
              <span style={{ marginBottom: 12, color: "var(--text-muted)" }} title={t("recBilling.feeLocked", "Set by the doctor's consultation fee")}>🔒</span>
            ) : (
              <button className="btn small danger" style={{ marginBottom: 12 }} onClick={() => removeItem(idx)}>✕</button>
            )}
          </div>
        ))}
        <button className="btn secondary small" onClick={addItem}>+ {t("recBilling.addLineItem")}</button>

        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div><label>{t("recBilling.discount")} (₹)</label><input className="input" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          <div><label>{t("recBilling.taxGst")} (%)</label><input className="input" type="number" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--text-muted)", marginTop: 12 }}>
          {t("recBilling.subtotal")}: ₹{subtotalPreview.toFixed(2)} · {t("recBilling.discount")}: ₹{discountPreview.toFixed(2)} ·{" "}
          {t("recBilling.tax")}: ₹{taxPreview.toFixed(2)} · <strong>{t("patPayments.total")}: ₹{totalPreview.toFixed(2)}</strong>
        </p>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 0 }}>
          {t("recBilling.feeAuthoritative", "The consultation fee is set by the doctor and cannot be edited here.")}
        </p>
        <button className="btn" onClick={generateInvoice} disabled={!apptInfo || lookupLoading}>{t("recBilling.generateInvoice")}</button>
      </div>

      {invoice && (
        <div className="card">
          <h3>{t("recBilling.invoice")} {invoice.invoice_number}</h3>
          <p>{t("docQueue.patient")}: {invoice.patient_name} ({invoice.patient_code}){invoice.doctor_name ? ` · ${t("dashboard.doctor")}: Dr. ${invoice.doctor_name}` : ""}</p>

          {invoice.insurance && invoice.insurance.length > 0 && (
            <div style={{ background: "var(--bg-subtle, #f8fafc)", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
              <strong>{t("recBilling.insuranceOnFile")}</strong>
              {invoice.insurance.map((ins) => (
                <p key={ins.id} style={{ margin: "4px 0" }}>
                  {ins.is_primary && <span className="pill">{t("patInsurance.primary")}</span>} {ins.provider} — {t("recBilling.policy")} #{ins.policy_number}
                  {ins.member_id ? ` · ${t("patInsurance.memberId")} ${ins.member_id}` : ""}
                  {ins.valid_until ? ` · ${t("patInsurance.validUntil")} ${ins.valid_until}` : ""}
                </p>
              ))}
            </div>
          )}
          <div className="table-wrap"><table>
            <thead><tr><th>{t("recBilling.item")}</th><th>{t("recBilling.qty")}</th><th>{t("recBilling.unit")}</th><th>{t("patPayments.total")}</th></tr></thead>
            <tbody>
              {invoice.items.map((it) => (
                <tr key={it.id}><td>{it.description}</td><td>{it.quantity}</td><td>₹{it.unit_price}</td><td>₹{it.line_total}</td></tr>
              ))}
            </tbody>
          </table></div>
          <p>{t("recBilling.subtotal")}: ₹{invoice.subtotal} · {t("recBilling.discount")}: ₹{invoice.discount} · {t("recBilling.tax")}: ₹{invoice.tax_gst}</p>
          <h3>{t("patPayments.total")}: ₹{invoice.total_amount} — <span className={`badge ${invoice.payment_status}`}>{invoice.payment_status}</span></h3>

          <h4>{t("recBilling.recordPayment")}</h4>
          <div className="grid grid-3">
            <input className="input" type="number" placeholder={t("recBilling.amount")} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option>Cash</option><option>UPI</option><option>Card</option><option>Online Payment</option>
            </select>
            <button className="btn" onClick={recordPayment}>{t("recBilling.recordPayment")}</button>
          </div>

          {invoice.payments.length > 0 && (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("recBilling.paymentId")}</th><th>{t("recBilling.amount")}</th><th>{t("recBilling.method")}</th><th>{t("common.date")}</th></tr></thead>
              <tbody>
                {invoice.payments.map((p) => (
                  <tr key={p.id}><td>{p.payment_id}</td><td>₹{p.amount}</td><td>{p.method}</td><td>{p.transaction_date}</td></tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}