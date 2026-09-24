"use client";

/**
 * components/print/documents.tsx
 *
 * The console's printable documents. Each loads its own data, draws nothing
 * until that data is in, and reports when it is through usePrintReadiness —
 * so one component prints in place from any page (printDocument) and also
 * stands alone on its print route.
 */

import { useEffect, useState, type ReactNode } from "react";
import { getDoc } from "firebase/firestore";
import { useConcessionaire } from "@/lib/firebase/useConcessionaires";
import { fetchBills, paymentDocRef } from "@/lib/firebase/bills";
import type { Concessionaire, MonthlyBillingRecord, PaymentRecord } from "@/lib/firebase/types";
import { daysOverdue, monthSortKey, paymentStatus, PAYMENT_STATUS_STYLES } from "@/lib/billing";
import { daysPastDue, formatDueDate } from "@/lib/dueDates";
import { formatPeso, getFullName } from "@/lib/utils";
import { usePrintReadiness } from "@/components/print/PrintHost";

const ACCOUNT_NOT_FOUND = "That account could not be found.";
const PAYMENT_NOT_FOUND = "That payment record could not be found.";

// ── Shared pieces ────────────────────────────────────────────────────────────

function barangayName(barangay: string) {
  return barangay === "CG" ? "Cebuano Group" : barangay;
}

function longDate(iso: string | undefined) {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "—";
}

function DocumentFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[800px] bg-white font-sans text-black">
      <div className="border border-slate-800 p-8">{children}</div>
    </div>
  );
}

function DocumentHeader({
  title,
  generatedOn,
  voidReason,
}: {
  title: string;
  generatedOn?: Date;
  /** Present when the document is for a voided payment. */
  voidReason?: string;
}) {
  return (
    <div className="mb-6 border-b border-slate-800 pb-6 text-center">
      <h1 className="mb-1 text-2xl font-bold uppercase tracking-widest">South Wao Water System</h1>
      <p className="text-xs font-medium text-slate-500">Wao, Lanao del Sur • Tel: 0985 762 5456</p>
      <p className="mt-2 text-sm font-medium uppercase text-slate-600">{title}</p>
      {generatedOn && (
        <p className="mt-2 text-xs font-medium text-slate-400">Date Generated: {generatedOn.toLocaleDateString()}</p>
      )}
      {voidReason !== undefined && (
        <p className="mt-3 inline-block border-2 border-red-700 px-3 py-1 text-sm font-bold uppercase tracking-widest text-red-700">
          Void{voidReason ? ` — ${voidReason}` : ""}
        </p>
      )}
    </div>
  );
}

function AccountInformation({ concessionaire, showStatus }: { concessionaire: Concessionaire; showStatus?: boolean }) {
  const row = (label: string, value: ReactNode, first = false) => (
    <p className={`text-sm font-bold text-slate-800 ${first ? "" : "mt-1"}`}>
      {label}: <span className="ml-2 font-medium text-slate-700">{value}</span>
    </p>
  );
  return (
    <div className="mb-8 rounded border border-slate-200 bg-slate-50 p-4">
      <p className="mb-1 text-xs font-bold uppercase text-slate-500">Account Information</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          {row("Name", getFullName(concessionaire), true)}
          {row("Barangay", barangayName(concessionaire.barangay))}
          {row("Purok", concessionaire.purok)}
        </div>
        <div>
          {row("Account #", concessionaire.accountNumber || "N/A", true)}
          {row("Meter #", concessionaire.meterNumber || "N/A")}
          {row("Class", concessionaire.classification || "N/A")}
          {showStatus && row("Status", concessionaire.status || "CONNECTED")}
        </div>
      </div>
    </div>
  );
}

function ReceivedFrom({ concessionaire }: { concessionaire: Concessionaire }) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold uppercase text-slate-500">Received From</p>
      <p className="text-lg font-bold">{getFullName(concessionaire)}</p>
      <p className="text-sm">
        {barangayName(concessionaire.barangay)} • Purok {concessionaire.purok}
      </p>
      <p className="mt-1 text-sm">
        Account #: <strong>{concessionaire.accountNumber || "N/A"}</strong>
      </p>
      <p className="text-sm">
        Meter #: <strong>{concessionaire.meterNumber || "N/A"}</strong>
      </p>
    </div>
  );
}

function SummaryTable({ rows }: { rows: { label: string; value: string; tone?: "paid" | "total" }[] }) {
  return (
    <div className="mt-8 flex justify-end border-t-4 border-slate-800 pt-6">
      <table className="w-64 text-sm">
        <tbody>
          {rows.map((r) =>
            r.tone === "total" ? (
              <tr key={r.label} className="border-t border-slate-300">
                <td className="py-2 text-lg font-bold uppercase">{r.label}</td>
                <td className="py-2 text-right text-xl font-bold">{r.value}</td>
              </tr>
            ) : (
              <tr key={r.label}>
                <td className="py-1 font-bold text-slate-600">{r.label}</td>
                <td className={`py-1 text-right font-bold ${r.tone === "paid" ? "text-emerald-600" : ""}`}>{r.value}</td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

function SignatureLine({ note }: { note?: string }) {
  return (
    <div className="mt-16 w-64 border-t border-slate-200 pt-8">
      <p className="text-center text-xs font-bold uppercase text-slate-500">Authorized Signature</p>
      {note && <p className="mt-1 text-center text-[10px] text-slate-400">{note}</p>}
    </div>
  );
}

// ── Water bill payment receipt ───────────────────────────────────────────────

export function PaymentReceipt({ concessionaireId, orNumber }: { concessionaireId: string; orNumber: string }) {
  const { concessionaire, loading } = useConcessionaire(concessionaireId);
  const lookupKey = `${concessionaireId}|${orNumber}`;
  const [lookup, setLookup] = useState<{ key: string; payment: PaymentRecord | null } | null>(null);

  // Payments are documents of their own now; the legacy array is still checked
  // for accounts the storage migration hasn't reached.
  useEffect(() => {
    if (!concessionaire || !orNumber) return;
    let cancelled = false;
    const fromArray = () => concessionaire.payments?.find((p) => p.orNumber === orNumber) ?? null;
    getDoc(paymentDocRef(concessionaireId, orNumber))
      .then((snap) => {
        if (!cancelled) setLookup({ key: lookupKey, payment: snap.exists() ? (snap.data() as PaymentRecord) : fromArray() });
      })
      .catch(() => {
        if (!cancelled) setLookup({ key: lookupKey, payment: fromArray() });
      });
    return () => {
      cancelled = true;
    };
  }, [concessionaire, concessionaireId, orNumber, lookupKey]);

  const payment = !orNumber ? null : lookup?.key === lookupKey ? lookup.payment : undefined;
  const error = !loading && !concessionaire ? ACCOUNT_NOT_FOUND : payment === null ? PAYMENT_NOT_FOUND : null;
  usePrintReadiness(Boolean(concessionaire && payment), error);

  if (!concessionaire || !payment) return null;

  return (
    <DocumentFrame>
      <DocumentHeader
        title="Water Bill Official Receipt"
        voidReason={payment.voided ? payment.voidReason ?? "" : undefined}
      />

      <div className="mb-8 grid grid-cols-2 gap-8">
        <ReceivedFrom concessionaire={concessionaire} />
        <div className="text-right">
          <p className="mb-1 text-xs font-bold uppercase text-slate-500">OR Number</p>
          <p className="font-mono text-xl font-bold text-slate-900">{payment.orNumber}</p>
          <p className="mb-1 mt-4 text-xs font-bold uppercase text-slate-500">Date</p>
          <p className="text-sm font-medium">{longDate(payment.date)}</p>
        </div>
      </div>

      <table className="mb-8 w-full">
        <thead>
          <tr className="border-b-2 border-slate-800">
            <th className="py-2 text-left text-sm font-bold uppercase tracking-wider">Description</th>
            <th className="py-2 text-right text-sm font-bold uppercase tracking-wider">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-200">
            <td className="py-4 text-base font-medium">Water Bill Payment</td>
            <td className="py-4 text-right text-lg font-bold">{formatPeso(payment.amount)}</td>
          </tr>
        </tbody>
      </table>

      <div className="flex items-end justify-between border-t border-slate-800 pt-6">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase text-slate-500">
            Balance Before: <span className="ml-2 text-slate-900">{formatPeso(payment.balanceBefore)}</span>
          </p>
          <p className="text-xs font-bold uppercase text-slate-500">
            Balance After: <span className="ml-2 text-slate-900">{formatPeso(payment.balanceAfter)}</span>
          </p>
          {/* Only when more cash was handed over than was owed: the rest went
              back as change, and the receipt says so for the drawer count. */}
          {payment.changeGiven ? (
            <>
              <p className="text-xs font-bold uppercase text-slate-500">
                Cash Received:{" "}
                <span className="ml-2 text-slate-900">
                  {formatPeso(payment.cashTendered ?? payment.amount)}
                </span>
              </p>
              <p className="text-xs font-bold uppercase text-slate-500">
                Change: <span className="ml-2 text-slate-900">{formatPeso(payment.changeGiven)}</span>
              </p>
            </>
          ) : null}
        </div>
        <div className="text-right">
          <p className="mb-1 text-xs font-bold uppercase text-slate-500">Amount Paid</p>
          <p className="text-3xl font-bold">{formatPeso(payment.amount)}</p>
        </div>
      </div>

      <SignatureLine note={`Recorded by: ${payment.recordedBy}`} />
    </DocumentFrame>
  );
}

// ── Water bill statement of account ──────────────────────────────────────────

export function WaterBillStatement({ concessionaireId }: { concessionaireId: string }) {
  const { concessionaire, loading } = useConcessionaire(concessionaireId);
  const [generatedOn] = useState(() => new Date());
  const [loaded, setLoaded] = useState<{ id: string; bills: MonthlyBillingRecord[] } | null>(null);

  // Bills are documents of their own now; reading only the old array printed an
  // empty statement for every account imported or migrated since.
  useEffect(() => {
    if (!concessionaire) return;
    let cancelled = false;
    fetchBills(concessionaireId, concessionaire.billingHistory)
      .then((bills) => {
        if (!cancelled) setLoaded({ id: concessionaireId, bills });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: concessionaireId, bills: concessionaire.billingHistory ?? [] });
      });
    return () => {
      cancelled = true;
    };
  }, [concessionaire, concessionaireId]);

  const loadedBills = loaded?.id === concessionaireId ? loaded.bills : null;
  usePrintReadiness(Boolean(concessionaire && loadedBills), !loading && !concessionaire ? ACCOUNT_NOT_FOUND : null);

  if (!concessionaire || !loadedBills) return null;

  // Oldest first, like a bank statement. A voided bill was reversed, so it is
  // not part of what the account owes.
  const bills = loadedBills
    .filter((b) => !b.voided)
    .sort((a, b) => monthSortKey(a.month) - monthSortKey(b.month));
  const totalBilled = bills.reduce((sum, b) => sum + b.pesoAmount, 0);
  const totalPaid = bills.reduce((sum, b) => sum + b.amountPaid, 0);

  return (
    <DocumentFrame>
      <DocumentHeader title="Statement of Account (Water Bill)" generatedOn={generatedOn} />
      <AccountInformation concessionaire={concessionaire} showStatus />

      <div className="mb-8">
        <p className="mb-4 border-b border-slate-800 pb-2 text-sm font-bold uppercase tracking-wider text-slate-800">
          Billing History
        </p>
        {bills.length === 0 ? (
          <p className="py-4 text-sm italic text-slate-500">No billing history recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-slate-600">
                <th className="py-2 text-left font-semibold">Month</th>
                <th className="py-2 text-left font-semibold">Due</th>
                <th className="py-2 text-right font-semibold">Amount Due</th>
                <th className="py-2 text-right font-semibold">Amount Paid</th>
                <th className="py-2 text-right font-semibold">Balance</th>
                <th className="py-2 text-center font-semibold">Status</th>
                <th className="py-2 text-right font-semibold">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b, i) => {
                const status = paymentStatus(b.pesoAmount, b.amountPaid);
                const balance = b.pesoAmount - b.amountPaid;
                // Days past the bill's own due date. A bill imported without
                // one falls back to days since it was issued, as before.
                const overdue =
                  status === "PAID"
                    ? null
                    : b.dueDateMillis
                      ? daysPastDue(b.dueDateMillis)
                      : daysOverdue(b.billingDate);
                return (
                  <tr key={`${b.month}-${i}`} className="border-b border-slate-100">
                    <td className="py-2">{b.month}</td>
                    <td className="py-2 text-xs text-slate-600">
                      {b.dueDateMillis ? formatDueDate(b.dueDateMillis, { short: true }) : "—"}
                    </td>
                    <td className="py-2 text-right font-medium">{formatPeso(b.pesoAmount)}</td>
                    <td className="py-2 text-right">{formatPeso(b.amountPaid)}</td>
                    <td className="py-2 text-right font-medium">{balance > 0 ? formatPeso(balance) : "—"}</td>
                    <td className="py-2 text-center">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${PAYMENT_STATUS_STYLES[status]}`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="py-2 text-right text-xs text-slate-500">
                      {overdue !== null && overdue > 0 ? `${overdue}d` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <SummaryTable
        rows={[
          { label: "Total Billed:", value: formatPeso(totalBilled) },
          { label: "Total Paid:", value: formatPeso(totalPaid), tone: "paid" },
          { label: "Balance Due:", value: formatPeso(concessionaire.billingBalance ?? 0), tone: "total" },
        ]}
      />
    </DocumentFrame>
  );
}

// ── Connection fee statement of account ──────────────────────────────────────

export function ConnectionFeeStatement({ concessionaireId }: { concessionaireId: string }) {
  const { concessionaire, loading } = useConcessionaire(concessionaireId);
  const [generatedOn] = useState(() => new Date());
  const details = concessionaire?.connectionFeeDetails;

  const error =
    !loading && !concessionaire
      ? ACCOUNT_NOT_FOUND
      : concessionaire && !details
        ? "This account has no connection fee details yet."
        : null;
  usePrintReadiness(Boolean(details), error);

  if (!concessionaire || !details) return null;

  const payments = concessionaire.meterPayments ?? [];
  // A voided payment was reversed: it stays on the statement, but paid nothing.
  const totalPaid = payments.reduce((sum, p) => (p.voided ? sum : sum + p.amount), 0);

  return (
    <DocumentFrame>
      <DocumentHeader title="Statement of Account (Connection)" generatedOn={generatedOn} />
      <AccountInformation concessionaire={concessionaire} />

      <div className="mb-8">
        <p className="mb-4 border-b border-slate-800 pb-2 text-sm font-bold uppercase tracking-wider text-slate-800">
          Fee Breakdown
        </p>
        <table className="w-full text-sm">
          <tbody>
            {[
              ["Water Meter", details.waterMeter],
              ["Application Fee", details.applicationFee],
              ["Inspection Fee", details.inspectionFee],
              ...(details.otherPayables ?? []).map((item) => [`Other: ${item.description || "Unspecified"}`, item.amount] as const),
            ].map(([label, amount], i) => (
              <tr key={`${label}-${i}`} className="border-b border-slate-100">
                <td className="py-2 text-slate-700">{label}</td>
                <td className="py-2 text-right font-medium">{formatPeso(Number(amount))}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-800">
              <td className="py-3 font-bold uppercase text-slate-800">Total Fees</td>
              <td className="py-3 text-right text-base font-bold">{formatPeso(details.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mb-8">
        <p className="mb-4 border-b border-slate-800 pb-2 text-sm font-bold uppercase tracking-wider text-slate-800">
          Payment History
        </p>
        {payments.length === 0 ? (
          <p className="py-4 text-sm italic text-slate-500">No payments recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-slate-600">
                <th className="py-2 text-left font-semibold">Date</th>
                <th className="py-2 text-left font-semibold">OR Number</th>
                <th className="py-2 text-left font-semibold">Installment</th>
                <th className="py-2 text-right font-semibold">Amount Paid</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={`${p.orNumber}-${i}`} className="border-b border-slate-100">
                  <td className="py-2">{p.date ? new Date(p.date).toLocaleDateString() : "—"}</td>
                  <td className="py-2 font-mono text-xs">{p.orNumber}</td>
                  <td className="py-2 text-xs uppercase tracking-wider">
                    {p.slot}
                    {p.voided && <span className="ml-2 font-bold text-red-700">Void</span>}
                  </td>
                  <td className={`py-2 text-right font-medium ${p.voided ? "text-slate-400 line-through" : ""}`}>
                    {formatPeso(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SummaryTable
        rows={[
          { label: "Total Fees:", value: formatPeso(details.total) },
          { label: "Total Paid:", value: formatPeso(totalPaid), tone: "paid" },
          { label: "Balance:", value: formatPeso(concessionaire.waterMeterBalance ?? 0), tone: "total" },
        ]}
      />
    </DocumentFrame>
  );
}

// ── Connection fee receipt ───────────────────────────────────────────────────

export function ConnectionFeeReceipt({
  concessionaireId,
  paymentIndex,
}: {
  concessionaireId: string;
  paymentIndex: number;
}) {
  const { concessionaire, loading } = useConcessionaire(concessionaireId);
  const payments = concessionaire?.meterPayments ?? [];
  const payment = payments[paymentIndex];

  const error = !loading && !concessionaire ? ACCOUNT_NOT_FOUND : concessionaire && !payment ? PAYMENT_NOT_FOUND : null;
  usePrintReadiness(Boolean(concessionaire && payment), error);

  if (!concessionaire || !payment) return null;

  const totalFee = concessionaire.connectionFeeDetails?.total || 0;
  // Balance as it stood after this payment. Voided payments paid nothing.
  const paidSoFar = payments.slice(0, paymentIndex + 1).reduce((sum, p) => (p.voided ? sum : sum + p.amount), 0);
  const remainingBalance = Math.max(0, totalFee - paidSoFar);

  return (
    <DocumentFrame>
      <DocumentHeader
        title="Connection Fee Official Receipt"
        voidReason={payment.voided ? payment.voidReason ?? "" : undefined}
      />

      <div className="mb-8 grid grid-cols-2 gap-8">
        <ReceivedFrom concessionaire={concessionaire} />
        <div className="text-right">
          <p className="mb-1 text-xs font-bold uppercase text-slate-500">OR Number</p>
          <p className="font-mono text-xl font-bold text-slate-900">{payment.orNumber}</p>
          <p className="mb-1 mt-4 text-xs font-bold uppercase text-slate-500">Date</p>
          <p className="text-sm font-medium">{longDate(payment.date)}</p>
        </div>
      </div>

      <table className="mb-8 w-full">
        <thead>
          <tr className="border-b-2 border-slate-800">
            <th className="py-2 text-left text-sm font-bold uppercase tracking-wider">Description</th>
            <th className="py-2 text-right text-sm font-bold uppercase tracking-wider">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-200">
            <td className="py-4 text-base font-medium">
              Connection Fee - {payment.slot === "Full" ? "Full Payment" : `${payment.slot} Installment`}
            </td>
            <td className="py-4 text-right text-lg font-bold">{formatPeso(payment.amount)}</td>
          </tr>
        </tbody>
      </table>

      <div className="flex items-end justify-between border-t border-slate-800 pt-6">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase text-slate-500">
            Total Connection Fee: <span className="ml-2 text-slate-900">{formatPeso(totalFee)}</span>
          </p>
          <p className="text-xs font-bold uppercase text-slate-500">
            Remaining Balance: <span className="ml-2 text-slate-900">{formatPeso(remainingBalance)}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="mb-1 text-xs font-bold uppercase text-slate-500">Amount Paid</p>
          <p className="text-3xl font-bold">{formatPeso(payment.amount)}</p>
        </div>
      </div>

      <SignatureLine />
    </DocumentFrame>
  );
}
