import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import PrintableReceipt from "../../components/PrintableReceipt";
import { useLanguage } from "../../context/LanguageContext";

export default function PatientPayments() {
  const [invoices, setInvoices] = useState([]);
  const [viewing, setViewing] = useState(null);
  const { t } = useLanguage();

  useEffect(() => { api.get("/patients/invoices").then((r) => setInvoices(r.data)); }, []);

  const view = async (inv) => {
    const res = await api.get(`/invoices/${inv.id}`);
    setViewing(res.data);
  };

  return (
    <DashboardLayout title={t("nav.payments")}>
      {!viewing ? (
        <div className="card">
          {invoices.length === 0 ? <div className="empty-state">{t("patPayments.empty")}</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("patPayments.invoiceNumber")}</th><th>{t("dashboard.clinic")}</th><th>{t("patPayments.total")}</th><th>{t("common.status")}</th><th></th></tr></thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td>{i.invoice_number}</td><td>{i.clinic_name}</td><td>₹{i.total_amount}</td>
                    <td><span className={`badge ${i.payment_status}`}>{i.payment_status}</span></td>
                    <td><button className="btn small" onClick={() => view(i)}>{t("patPayments.viewPrint")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      ) : (
        <div className="card">
          <button className="btn secondary small no-print" onClick={() => setViewing(null)}>← {t("common.back", "Back")}</button>
          <PrintableReceipt invoice={viewing} />
        </div>
      )}
    </DashboardLayout>
  );
}
