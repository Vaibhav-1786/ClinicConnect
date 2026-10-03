import React, { useEffect, useState } from "react";
import api from "../../services/api";
import DashboardLayout from "../../layouts/DashboardLayout";
import PrintableReceipt from "../../components/PrintableReceipt";
import { useLanguage } from "../../context/LanguageContext";

export default function PatientPrescriptions() {
  const [list, setList] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const { t } = useLanguage();

  useEffect(() => { api.get("/prescriptions/patient").then((r) => setList(r.data)); }, []);

  const view = async (p) => {
    const res = await api.get(`/prescriptions/${p.id}`);
    setViewing(res.data);
    try {
      const invoices = await api.get("/patients/invoices");
      const match = invoices.data.find((inv) => inv.appointment_id === p.appointment_id);
      if (match) {
        const invRes = await api.get(`/invoices/${match.id}`);
        setInvoice(invRes.data);
      } else {
        setInvoice(null);
      }
    } catch { setInvoice(null); }
  };

  return (
    <DashboardLayout title={t("nav.prescriptions")}>
      {!viewing ? (
        <div className="card">
          {list.length === 0 ? <div className="empty-state">{t("patPrescriptions.empty")}</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("common.date")}</th><th>{t("dashboard.doctor")}</th><th>{t("dashboard.clinic")}</th><th></th></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td>{p.prescription_date}</td><td>Dr. {p.doctor_name}</td><td>{p.clinic_name}</td>
                    <td><button className="btn small" onClick={() => view(p)}>{t("patPayments.viewPrint")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      ) : (
        <div className="card">
          <button className="btn secondary small no-print" onClick={() => setViewing(null)}>← {t("common.back")}</button>
          {invoice ? (
            <PrintableReceipt invoice={invoice} prescription={viewing} />
          ) : (
            <div style={{ marginTop: 12 }}>
              <h3>{t("patPrescriptions.diagnosis")}: {viewing.diagnosis_text}</h3>
              <div className="table-wrap"><table>
                <thead><tr><th>{t("patMedicine.medicine")}</th><th>{t("patPrescriptions.dosage")}</th><th>{t("patPrescriptions.frequency")}</th><th>{t("patPrescriptions.duration")}</th></tr></thead>
                <tbody>
                  {viewing.items.map((it) => (
                    <tr key={it.id}><td>{it.medicine_name}</td><td>{it.dosage}</td><td>{it.frequency}</td><td>{it.duration}</td></tr>
                  ))}
                </tbody>
              </table></div>
              <p style={{ color: "var(--text-muted)" }}>{t("patPrescriptions.noInvoice")}</p>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
