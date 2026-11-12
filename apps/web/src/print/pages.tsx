import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Link2, Printer } from 'lucide-react';
import { formatINR, formatQty, type CompanyProfile, type Invoice, type Payment, type Payslip, type ProfitSettlement, type SettlementLine, type GoodsReceipt, type SupplierPayment, type Supplier, type ProductionBatch, type Attendance, type BankAccount } from '@app/contract';
import { api } from '../api/client';
import { Button } from '../ui/Button';
import { ErrorState, Skeleton, useToast } from '../ui/feedback';
import { Select } from '../ui/form';
import { MODE_LABEL, PAYTYPE_LABEL, TYPE_LABEL } from '../features/common';
import { DOC_CSS, PagedDocument, SinglePage } from './engine';
import { CompactHeader, DocHeader, KV, LabeledLines, PartyColumns, Qr, Signatory, SignatureLine, d } from './parts';

const money = (p: number) => formatINR(p, { symbol: false });
/** Standard short units so the 11 mm unit column never wraps. */
const UNIT: Record<string, string> = { packet: 'pkt', piece: 'pcs', kilogram: 'kg' };
const unit = (u: string) => UNIT[u.toLowerCase()] ?? u;

function PrintScreen({ title, children, loading, error, actions }: { title: string; children: ReactNode; loading: boolean; error: unknown; actions?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div>
      <style>{DOC_CSS}</style>
      <div className="no-print sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b border-hairline bg-white px-6 py-3">
        <Button variant="quiet" icon={<ArrowLeft className="h-4 w-4" strokeWidth={1.5} />} onClick={() => navigate(-1)}>
          Back
        </Button>
        <h1 className="mr-auto text-section font-semibold text-deep">{title}</h1>
        {actions}
        <Button variant="secondary" onClick={() => window.print()} title="In the print dialog choose Save as PDF">
          Download PDF
        </Button>
        <Button variant="primary" icon={<Printer className="h-4 w-4" strokeWidth={1.5} />} onClick={() => window.print()}>
          Print
        </Button>
      </div>
      {error ? (
        <ErrorState error={error} />
      ) : loading ? (
        <div className="flex justify-center bg-mist py-8">
          <Skeleton className="h-[297mm] w-[210mm]" />
        </div>
      ) : (
        <div className="print-root" data-testid="print-root">
          {children}
        </div>
      )}
    </div>
  );
}

/* Tax invoice */
interface InvoicePrint {
  invoice: Invoice & { displayStatus: string; balance: number };
  company: CompanyProfile;
  party: { name: string; address: string; gstin?: string; state: string; stateCode: string; phone: string };
  bank: BankAccount | null;
  amountInWords: string;
  upiUri: string | null;
  taxCharged: boolean;
  createdBy: string;
}

const COPIES = ['Original for Recipient', 'Duplicate for Transporter', 'Triplicate for Supplier'];

export function InvoiceDocument({ data, copy }: { data: InvoicePrint; copy: string }) {
  const { invoice: inv, company, party } = data;
  const title = data.taxCharged ? 'TAX INVOICE' : 'BILL OF SUPPLY';
  const fields: [string, ReactNode][] = [
    ['Invoice no.', inv.number ?? 'Draft'],
    ['Date', d(inv.date)],
    ...(inv.dueDate ? ([['Due date', d(inv.dueDate)]] as [string, ReactNode][]) : []),
  ];
  const columns = [
    { label: 'S.No', width: 8, align: 'center' as const },
    { label: 'Description', width: 46 },
    { label: 'HSN', width: 16 },
    { label: 'Qty', width: 14, align: 'right' as const },
    { label: 'Unit', width: 11 },
    { label: 'Rate', width: 20, align: 'right' as const },
    { label: 'Discount', width: 14, align: 'right' as const },
    { label: 'Taxable value', width: 22, align: 'right' as const },
    { label: 'GST %', width: 11, align: 'right' as const },
    { label: 'Amount', width: 28, align: 'right' as const },
  ];
  const rows = inv.items.map((it, i) => [i + 1, `${it.name} (${it.code})`, it.hsn ?? '', formatQty(it.qty), unit(it.unit), money(it.rate), it.discount ? money(it.discount) : '', money(it.taxableValue), `${it.gstRate}%`, money(it.lineTotal)]);
  const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const it of inv.items) {
    const r = byRate.get(it.gstRate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    r.taxable += it.taxableValue;
    r.cgst += it.cgst;
    r.sgst += it.sgst;
    r.igst += it.igst;
    byRate.set(it.gstRate, r);
  }
  const party1 = (
    <PartyColumns
      left={<LabeledLines heading="Bill to" lines={[party.name, party.address, party.gstin ? `GSTIN ${party.gstin}` : 'Unregistered', party.phone]} />}
      right={
        <LabeledLines
          heading="Supply details"
          lines={[`Place of supply: ${inv.placeOfSupply} (${inv.placeOfSupplyCode})`, `${TYPE_LABEL[inv.type]} bill`, inv.intraState ? 'Intra-state supply (CGST and SGST)' : 'Inter-state supply (IGST)', inv.status === 'CANCELLED' ? `Cancelled: ${inv.cancelReason ?? ''}` : null]}
        />
      }
    />
  );
  const tail = (
    <div style={{ breakInside: 'avoid', paddingTop: '3mm' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6mm' }}>
        <table className="doc-table" style={{ width: '104mm', borderCollapse: 'collapse', alignSelf: 'flex-start' }}>
          <thead>
            <tr>
              <th>GST rate</th>
              <th style={{ textAlign: 'right' }}>Taxable</th>
              {inv.intraState ? (
                <>
                  <th style={{ textAlign: 'right' }}>CGST</th>
                  <th style={{ textAlign: 'right' }}>SGST</th>
                </>
              ) : (
                <th style={{ textAlign: 'right' }}>IGST</th>
              )}
              <th style={{ textAlign: 'right' }}>Total tax</th>
            </tr>
          </thead>
          <tbody>
            {[...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, r]) => (
              <tr key={rate}>
                <td style={{ height: 'auto' }}>{rate}%</td>
                <td style={{ textAlign: 'right', height: 'auto' }}>{money(r.taxable)}</td>
                {inv.intraState ? (
                  <>
                    <td style={{ textAlign: 'right', height: 'auto' }}>{money(r.cgst)}</td>
                    <td style={{ textAlign: 'right', height: 'auto' }}>{money(r.sgst)}</td>
                  </>
                ) : (
                  <td style={{ textAlign: 'right', height: 'auto' }}>{money(r.igst)}</td>
                )}
                <td style={{ textAlign: 'right', height: 'auto' }}>{money(r.cgst + r.sgst + r.igst)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <KV
          rows={[
            ['Gross amount', money(inv.subtotal)],
            ['Discount', inv.discountTotal ? `−${money(inv.discountTotal)}` : money(0)],
            ['Taxable value', money(inv.taxableTotal)],
            ...(inv.intraState
              ? ([
                  ['CGST', money(inv.cgst)],
                  ['SGST', money(inv.sgst)],
                ] as [string, string][])
              : ([['IGST', money(inv.igst)]] as [string, string][])),
            ['Round-off', inv.roundOff < 0 ? `−${money(-inv.roundOff)}` : money(inv.roundOff)],
            ['Grand total', formatINR(inv.grandTotal), true],
          ]}
        />
      </div>
      <div className="doc-words" style={{ padding: '2.5mm 0', borderBottom: '0.2mm solid #DCE2EA' }}>
        Amount in words: {data.amountInWords}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '64mm 1fr 56mm', gap: '5mm', paddingTop: '3mm', alignItems: 'start' }}>
        <div style={{ display: 'flex', gap: '3mm' }}>
          {data.upiUri ? <Qr text={data.upiUri} /> : null}
          {data.bank ? (
            <LabeledLines heading="Bank details" lines={[data.bank.bankName, `A/c ${data.bank.accountNo}`, `IFSC ${data.bank.ifsc}`, `UPI ${data.bank.upiId}`, data.upiUri ? `Scan to pay ${formatINR(inv.balance)}` : null]} />
          ) : null}
        </div>
        <LabeledLines heading="Terms and conditions" lines={[' ', company.invoiceTerms]} />
        <Signatory label={company.signatoryLabel} brand={company.brandName} />
      </div>
    </div>
  );
  return (
    <PagedDocument
      header={() => <DocHeader company={company} title={title} fields={fields} extra={<div className="doc-label">{copy}</div>} party={party1} />}
      compactHeader={(p, n) => <CompactHeader company={company} title={title} fields={fields} page={p} pages={n} />}
      columns={columns}
      rows={rows}
      tail={tail}
      footerNote={company.footerNote}
    />
  );
}

export function InvoicePrintPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [copy, setCopy] = useState(COPIES[0] as string);
  const q = useQuery({ queryKey: ['invoice-print', id], queryFn: () => api.get<InvoicePrint>(`/invoices/${id}/print-data`) });
  const link = `${window.location.origin}/bills/${id}`;
  const share = q.data
    ? `${q.data.company.brandName}: invoice ${q.data.invoice.number ?? ''} for ${formatINR(q.data.invoice.grandTotal)} dated ${d(q.data.invoice.date)}. ${q.data.invoice.balance > 0 ? `Balance due ${formatINR(q.data.invoice.balance)}.` : 'Paid in full.'}`
    : '';
  return (
    <PrintScreen
      title={q.data ? `Invoice ${q.data.invoice.number ?? 'draft'}` : 'Invoice'}
      loading={q.isLoading}
      error={q.error}
      actions={
        <>
          <label className="sr-only" htmlFor="copy">
            Copy label
          </label>
          <Select id="copy" value={copy} onChange={(e) => setCopy(e.target.value)} className="w-[230px]">
            {COPIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Button
            variant="quiet"
            icon={<Link2 className="h-4 w-4" strokeWidth={1.5} />}
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => toast.success('Link copied'));
            }}
          >
            Copy link
          </Button>
          <a className="inline-flex h-9 items-center rounded-ctl px-3 text-base font-medium text-tide hover:bg-mist" href={`https://wa.me/?text=${encodeURIComponent(`${share} ${link}`)}`} target="_blank" rel="noreferrer">
            Share on WhatsApp
          </a>
        </>
      }
    >
      {q.data ? <InvoiceDocument data={q.data} copy={copy} /> : null}
    </PrintScreen>
  );
}

/* Payment receipt */
interface ReceiptPrint {
  payment: Payment;
  company: CompanyProfile;
  party: { name: string; address: string; gstin?: string; phone: string };
  allocations: { number: string; date: string; total: number; amount: number }[];
  amountInWords: string;
  receivedBy: string;
}

export function ReceiptPrintPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['receipt-print', id], queryFn: () => api.get<ReceiptPrint>(`/payments/${id}/print-data`) });
  const r = q.data;
  return (
    <PrintScreen title={r ? `Receipt ${r.payment.receiptNo}` : 'Receipt'} loading={q.isLoading} error={q.error}>
      {r ? (
        <SinglePage footerNote={r.company.footerNote}>
          <DocHeader
            company={r.company}
            title="PAYMENT RECEIPT"
            fields={[
              ['Receipt no.', r.payment.receiptNo],
              ['Date', d(r.payment.date)],
            ]}
            party={
              <PartyColumns
                left={<LabeledLines heading="Received from" lines={[r.party.name, r.party.address, r.party.gstin ? `GSTIN ${r.party.gstin}` : null, r.party.phone]} />}
                right={<LabeledLines heading="Payment" lines={[`${MODE_LABEL[r.payment.mode]}${r.payment.reference ? `, reference ${r.payment.reference}` : ''}`, r.payment.invoiceId ? 'Against the bill below' : 'On account, applied to the oldest bills first']} />}
              />
            }
          />
          <table className="doc-table" style={{ width: '190mm', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>Bill</th>
                <th>Bill date</th>
                <th style={{ textAlign: 'right' }}>Bill amount</th>
                <th style={{ textAlign: 'right' }}>Applied</th>
              </tr>
            </thead>
            <tbody>
              {r.allocations.map((a) => (
                <tr key={a.number}>
                  <td>{a.number}</td>
                  <td>{d(a.date)}</td>
                  <td style={{ textAlign: 'right' }}>{money(a.total)}</td>
                  <td style={{ textAlign: 'right' }}>{money(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '3mm' }}>
            <KV rows={[['Amount received', formatINR(r.payment.amount), true]]} />
          </div>
          <div className="doc-words" style={{ padding: '2.5mm 0', borderBottom: '0.2mm solid #DCE2EA' }}>
            Amount in words: {r.amountInWords}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6mm' }}>
            <div className="doc-value">Received by {r.receivedBy}</div>
            <Signatory label={r.company.signatoryLabel} brand={r.company.brandName} />
          </div>
        </SinglePage>
      ) : null}
    </PrintScreen>
  );
}

/* Purchase order */
interface IndentPrint {
  indent: { number: string; poNumber?: string; date: string; approvedAt?: string; total: number; note: string };
  company: CompanyProfile;
  supplier: Supplier;
  items: { name: string; unit: string; qty: number; rate: number; amount: number }[];
  amountInWords: string;
  approvals: { stage: number; decision: string; by: string; at: string; remarks: string }[];
}

export function PurchaseOrderPrintPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['po-print', id], queryFn: () => api.get<IndentPrint>(`/indents/${id}/po-print-data`) });
  const r = q.data;
  const fields: [string, ReactNode][] = r
    ? [
        ['PO no.', r.indent.poNumber ?? ''],
        ['Date', d(r.indent.approvedAt?.slice(0, 10) ?? r.indent.date)],
        ['Indent', r.indent.number],
      ]
    : [];
  return (
    <PrintScreen title={r ? `Purchase order ${r.indent.poNumber}` : 'Purchase order'} loading={q.isLoading} error={q.error}>
      {r ? (
        <PagedDocument
          header={() => (
            <DocHeader
              company={r.company}
              title="PURCHASE ORDER"
              fields={fields}
              party={
                <PartyColumns
                  left={<LabeledLines heading="Supplier" lines={[r.supplier.name, r.supplier.address, r.supplier.gstin ? `GSTIN ${r.supplier.gstin}` : 'Unregistered', r.supplier.phone]} />}
                  right={<LabeledLines heading="Approved by" lines={r.approvals.filter((a) => a.decision === 'APPROVED').slice(-3).map((a) => `Stage ${a.stage}: ${a.by}, ${d(a.at.slice(0, 10))}`)} />}
                />
              }
            />
          )}
          compactHeader={(p, n) => <CompactHeader company={r.company} title="PURCHASE ORDER" fields={fields} page={p} pages={n} />}
          columns={[
            { label: 'S.No', width: 8, align: 'center' },
            { label: 'Item', width: 72 },
            { label: 'Unit', width: 16 },
            { label: 'Quantity', width: 24, align: 'right' },
            { label: 'Rate', width: 30, align: 'right' },
            { label: 'Amount', width: 40, align: 'right' },
          ]}
          rows={r.items.map((it, i) => [i + 1, it.name, unit(it.unit), formatQty(it.qty), money(it.rate), money(it.amount)])}
          tail={
            <div style={{ paddingTop: '3mm' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <KV rows={[['Order total', formatINR(r.indent.total), true]]} />
              </div>
              <div className="doc-words" style={{ padding: '2.5mm 0', borderBottom: '0.2mm solid #DCE2EA' }}>
                Amount in words: {r.amountInWords}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4mm' }}>
                <LabeledLines heading="Notes" lines={[' ', r.indent.note || 'Deliver with the supplier bill quoting this PO number.']} />
                <Signatory label={r.company.signatoryLabel} brand={r.company.brandName} />
              </div>
            </div>
          }
          footerNote={r.company.footerNote}
        />
      ) : null}
    </PrintScreen>
  );
}

/* Goods receipt note / purchase bill */
interface GrnPrint {
  receipt: GoodsReceipt;
  indent: { number: string; poNumber?: string };
  company: CompanyProfile;
  supplier: Supplier;
  items: { name: string; unit: string; qty: number; rate: number; indentRate: number; amount: number; variance: number }[];
  amountInWords: string;
  receivedBy: string;
}

export function GoodsReceiptPrintPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['grn-print', id], queryFn: () => api.get<GrnPrint>(`/purchase-bills/${id}/print-data`) });
  const r = q.data;
  const fields: [string, ReactNode][] = r
    ? [
        ['GRN no.', r.receipt.number],
        ['Date', d(r.receipt.date)],
        ['Supplier bill', r.receipt.supplierBillNo],
      ]
    : [];
  return (
    <PrintScreen title={r ? `Goods receipt ${r.receipt.number}` : 'Goods receipt'} loading={q.isLoading} error={q.error}>
      {r ? (
        <PagedDocument
          header={() => (
            <DocHeader
              company={r.company}
              title="GOODS RECEIPT NOTE"
              fields={fields}
              party={
                <PartyColumns
                  left={<LabeledLines heading="Supplier" lines={[r.supplier.name, r.supplier.address, r.supplier.gstin ? `GSTIN ${r.supplier.gstin}` : 'Unregistered']} />}
                  right={<LabeledLines heading="Against" lines={[`Indent ${r.indent.number}`, r.indent.poNumber ? `Purchase order ${r.indent.poNumber}` : null, `Supplier bill dated ${d(r.receipt.supplierBillDate)}`]} />}
                />
              }
            />
          )}
          compactHeader={(p, n) => <CompactHeader company={r.company} title="GOODS RECEIPT NOTE" fields={fields} page={p} pages={n} />}
          columns={[
            { label: 'S.No', width: 8, align: 'center' },
            { label: 'Item', width: 56 },
            { label: 'Unit', width: 14 },
            { label: 'Received', width: 20, align: 'right' },
            { label: 'Indent rate', width: 26, align: 'right' },
            { label: 'Bill rate', width: 26, align: 'right' },
            { label: 'Amount', width: 40, align: 'right' },
          ]}
          rows={r.items.map((it, i) => [i + 1, it.name, unit(it.unit), formatQty(it.qty), money(it.indentRate), money(it.rate), money(it.amount)])}
          tail={
            <div style={{ paddingTop: '3mm' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6mm' }}>
                <LabeledLines heading="Rate variance against the indent" lines={[' ', `${r.items.reduce((a, x) => a + x.variance, 0) >= 0 ? '+' : '−'}${formatINR(Math.abs(r.items.reduce((a, x) => a + x.variance, 0)))}`]} />
                <KV rows={[['Supplier bill amount', formatINR(r.receipt.billAmount), true]]} />
              </div>
              <div className="doc-words" style={{ padding: '2.5mm 0', borderBottom: '0.2mm solid #DCE2EA' }}>
                Amount in words: {r.amountInWords}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4mm' }}>
                <SignatureLine label={`Received by ${r.receivedBy}`} />
                <Signatory label={r.company.signatoryLabel} brand={r.company.brandName} />
              </div>
            </div>
          }
          footerNote={r.company.footerNote}
        />
      ) : null}
    </PrintScreen>
  );
}

/* Supplier payment voucher */
interface VoucherPrint {
  payment: SupplierPayment;
  indent: { number: string; total: number; received: number; paid: number };
  company: CompanyProfile;
  supplier: Supplier;
  amountInWords: string;
  paidBy: string;
}

export function SupplierVoucherPrintPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['voucher-print', id], queryFn: () => api.get<VoucherPrint>(`/supplier-payments/${id}/print-data`) });
  const r = q.data;
  return (
    <PrintScreen title={r ? `Voucher ${r.payment.number}` : 'Payment voucher'} loading={q.isLoading} error={q.error}>
      {r ? (
        <SinglePage footerNote={r.company.footerNote}>
          <DocHeader
            company={r.company}
            title="PAYMENT VOUCHER"
            fields={[
              ['Voucher no.', r.payment.number],
              ['Date', d(r.payment.date)],
            ]}
            party={
              <PartyColumns
                left={<LabeledLines heading="Paid to" lines={[r.supplier.name, r.supplier.address, r.supplier.gstin ? `GSTIN ${r.supplier.gstin}` : null]} />}
                right={<LabeledLines heading="Payment" lines={[`${MODE_LABEL[r.payment.mode]}${r.payment.reference ? `, reference ${r.payment.reference}` : ''}`, `Against indent ${r.indent.number}`]} />}
              />
            }
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <KV
              rows={[
                ['Indent value', money(r.indent.total)],
                ['Received value', money(r.indent.received)],
                ['Paid to date', money(r.indent.paid)],
                ['This payment', formatINR(r.payment.amount), true],
              ]}
            />
          </div>
          <div className="doc-words" style={{ padding: '2.5mm 0', borderBottom: '0.2mm solid #DCE2EA' }}>
            Amount in words: {r.amountInWords}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6mm' }}>
            <SignatureLine label="Received by (supplier)" />
            <Signatory label={r.company.signatoryLabel} brand={r.company.brandName} />
          </div>
        </SinglePage>
      ) : null}
    </PrintScreen>
  );
}

/* Payslip */
export interface PayslipPrint {
  payslip: Payslip;
  staff: { code: string; name: string; phone: string; joinDate: string; role: string };
  company: CompanyProfile;
  days: Attendance[];
  amountInWords: string;
}

export function PayslipDocument({ r }: { r: PayslipPrint }) {
  const p = r.payslip;
  const rate =
    p.payType === 'FIXED' ? `Base pay ${formatINR(p.rateSnapshot.basePay ?? 0)} a month` : p.payType === 'HOURLY' ? `${formatINR(p.rateSnapshot.hourlyRate ?? 0)} an hour` : `${p.rateSnapshot.sharePercent ?? 0}% of profit${p.rateSnapshot.reduceByAbsence ? `, reduced by absences (effective ${(p.rateSnapshot.effectivePercent ?? 0).toFixed(2)}%)` : ''}`;
  const earnings: [string, string][] = [[p.payType === 'SHARE' ? 'Profit share' : 'Base pay earned', money(p.basePayEarned)], ...p.lines.filter((l) => l.kind === 'ALLOWANCE').map((l) => [l.label, money(l.amount)] as [string, string])];
  const deductions: [string, string][] = [
    ...p.lines.filter((l) => l.kind === 'DEDUCTION').map((l) => [l.label, money(l.amount)] as [string, string]),
    ...(p.advanceRecovery ? ([['Advance recovery', money(p.advanceRecovery)]] as [string, string][]) : []),
    ...(p.alreadyPaid ? ([['Paid earlier this month', money(p.alreadyPaid)]] as [string, string][]) : []),
  ];
  return (
    <SinglePage footerNote={r.company.footerNote}>
      <DocHeader
        company={r.company}
        title="PAYSLIP"
        fields={[
          ['Payslip no.', p.number ?? 'Draft'],
          ['Period', `${d(p.periodFrom)} to ${d(p.periodTo)}`],
        ]}
        party={
          <PartyColumns
            left={<LabeledLines heading="Employee" lines={[r.staff.name, `Code ${r.staff.code}`, `Joined ${d(r.staff.joinDate)}`, r.staff.phone]} />}
            right={<LabeledLines heading="Pay type" lines={[PAYTYPE_LABEL[p.payType], rate, p.perDayRate ? `Per-day rate ${formatINR(p.perDayRate)} (${p.workingDaysInMonth} working days)` : null]} />}
          />
        }
      />
      <div className="doc-label" style={{ marginBottom: '1mm' }}>
        Attendance summary
      </div>
      <table className="doc-table" style={{ width: '190mm', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Working days', 'Present', 'Half days', 'Absent', 'Leave', 'Paid hours'].map((h) => (
              <th key={h} style={{ textAlign: 'right' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {[p.workingDaysInMonth, p.daysPresent, p.halfDays, p.absentDays, p.leaveDays, p.paidHours].map((v, i) => (
              <td key={i} style={{ textAlign: 'right' }}>
                {v}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8mm', paddingTop: '4mm' }}>
        <div>
          <div className="doc-label">Earnings</div>
          <KV width="100%" rows={[...earnings, ['Gross', money(p.gross)]]} />
        </div>
        <div>
          <div className="doc-label">Deductions</div>
          <KV width="100%" rows={deductions.length ? [...deductions, ['Total deductions', money(p.gross - p.net - p.roundOff)]] : [['None', money(0)]]} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '3mm' }}>
        <KV rows={[...(p.roundOff ? ([['Round-off', p.roundOff < 0 ? `−${money(-p.roundOff)}` : money(p.roundOff)]] as [string, string][]) : []), ['Net pay', formatINR(p.net), true]]} />
      </div>
      <div className="doc-words" style={{ padding: '2.5mm 0', borderBottom: '0.2mm solid #DCE2EA' }}>
        Net pay in words: {r.amountInWords}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4mm' }}>
        <LabeledLines heading="Payment" lines={[p.status === 'PAID' ? `${MODE_LABEL[p.mode ?? 'CASH']} on ${d(p.paidOn)}${p.reference ? `, reference ${p.reference}` : ''}` : 'Not paid yet', p.status === 'CANCELLED' ? `Cancelled: ${p.cancelReason ?? ''}` : null]} />
        <SignatureLine label="Received by" />
        <Signatory label={r.company.signatoryLabel} brand={r.company.brandName} />
      </div>
    </SinglePage>
  );
}

export function PayslipPrintPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['payslip-print', id], queryFn: () => api.get<PayslipPrint>(`/payslips/${id}/print-data`) });
  return (
    <PrintScreen title={q.data ? `Payslip ${q.data.payslip.number ?? 'draft'}` : 'Payslip'} loading={q.isLoading} error={q.error}>
      {q.data ? <PayslipDocument r={q.data} /> : null}
    </PrintScreen>
  );
}

/* Consolidated payslip and settlement statement (Admin only) */
interface ConsolidatedPrint {
  settlement: ProfitSettlement;
  company: CompanyProfile;
  loan: { lender?: string } | null;
  workers: (SettlementLine & { name: string; code: string; payslipNumber: string | null; paidOn: string | null })[];
  payslips: PayslipPrint[];
}

export function ConsolidatedPrintPage() {
  const { id = '' } = useParams();
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['consolidated-print', id], queryFn: () => api.get<ConsolidatedPrint>(`/settlements/${id}/consolidated-print-data`) });
  const r = q.data;
  const st = r?.settlement;
  const fields: [string, ReactNode][] = st ? [['Month', st.month], ['Status', st.status === 'FINALIZED' ? 'Finalized' : st.status === 'DRAFT' ? 'Draft' : 'Cancelled']] : [];
  return (
    <PrintScreen
      title={st ? `Settlement ${st.month}` : 'Settlement'}
      loading={q.isLoading}
      error={q.error}
      actions={
        <label className="flex items-center gap-2 text-sm text-deep">
          <input type="checkbox" className="h-4 w-4 accent-tide" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Include every individual payslip
        </label>
      }
    >
      {r && st ? (
        <>
          <SinglePage footerNote={r.company.footerNote}>
            <DocHeader company={r.company} title="SETTLEMENT STATEMENT" fields={fields} />
            <div className="doc-label" style={{ marginBottom: '1mm' }}>
              Profit waterfall
            </div>
            <KV
              width="120mm"
              rows={[
                ['Sales (taxable value)', money(st.sales)],
                ['Purchases (goods receipt bills)', money(st.purchases)],
                ['Gross profit', money(st.grossProfit)],
                [`Loan repayment${r.loan?.lender ? ` to ${r.loan.lender}` : ''}`, money(st.loanRepayment)],
                ['Pool after loan', money(st.poolAfterLoan)],
                ['Fixed and hourly workers', money(st.fixedHourlyTotal)],
                ['Profit share workers', money(st.shareTotal)],
                ['Worker total (computed)', money(st.workerTotal)],
                ['Scale applied', st.scaleFactor < 1 ? `${(st.scaleFactor * 100).toFixed(2)}%` : 'None'],
                ['Worker total (payable)', money(st.payableTotal)],
                ['Other expenses', money(st.otherExpenses)],
                ['Owner amount', st.ownerAmount < 0 ? `−${formatINR(-st.ownerAmount)} (deficit)` : formatINR(st.ownerAmount), true],
              ]}
            />
            {st.loanRepaymentUnpaid > 0 ? <p className="doc-value" style={{ marginTop: '3mm' }}>{formatINR(st.loanRepaymentUnpaid)} of the requested loan repayment could not be paid from this month’s profit and stays outstanding.</p> : null}
          </SinglePage>
          <PagedDocument
            header={() => <DocHeader company={r.company} title="CONSOLIDATED PAYSLIP" fields={fields} />}
            compactHeader={(p, n) => <CompactHeader company={r.company} title="CONSOLIDATED PAYSLIP" fields={fields} page={p} pages={n} />}
            columns={[
              { label: 'Worker', width: 28 },
              { label: 'Pay type', width: 22 },
              { label: 'Present', width: 13, align: 'right' },
              { label: 'Half', width: 10, align: 'right' },
              { label: 'Absent', width: 12, align: 'right' },
              { label: 'Leave', width: 11, align: 'right' },
              { label: 'Hours', width: 12, align: 'right' },
              { label: 'Earned', width: 20, align: 'right' },
              { label: 'Adjust.', width: 16, align: 'right' },
              { label: 'Recovery', width: 18, align: 'right' },
              { label: 'Net paid', width: 28, align: 'right' },
            ]}
            rows={r.workers.map((w) => [
              `${w.name} (${w.code})`,
              w.payType === 'SHARE' ? `Share ${w.sharePercent}%${w.reduceByAbsence ? `, eff. ${(w.effectivePercent ?? 0).toFixed(2)}%` : ''}` : PAYTYPE_LABEL[w.payType],
              w.presentDays,
              w.halfDays,
              w.absentDays,
              w.leaveDays,
              w.paidHours,
              money(w.scaled),
              w.adjustment ? money(w.adjustment) : '',
              w.advanceRecovery + w.alreadyPaid ? money(w.advanceRecovery + w.alreadyPaid) : '',
              money(w.balancePayable),
            ])}
            tail={
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '3mm' }}>
                <KV rows={[['Worker total', formatINR(st.payableTotal), true]]} />
              </div>
            }
            footerNote={r.company.footerNote}
          />
          {all ? r.payslips.map((p) => <PayslipDocument key={p.payslip.id} r={p} />) : null}
        </>
      ) : null}
    </PrintScreen>
  );
}

/* Production batch sheet */
interface BatchPrint {
  batch: ProductionBatch;
  by: string;
  company: CompanyProfile;
  inputs: { name: string; unit: string; qty: number }[];
  outputs: { code: string; name: string; unit: string; qty: number }[];
}

export function BatchPrintPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['batch-print', id], queryFn: () => api.get<BatchPrint>(`/production-batches/${id}/print-data`) });
  const r = q.data;
  const fields: [string, ReactNode][] = r
    ? [
        ['Batch no.', r.batch.batchNo],
        ['Date', d(r.batch.date)],
      ]
    : [];
  return (
    <PrintScreen title={r ? `Batch ${r.batch.batchNo}` : 'Batch sheet'} loading={q.isLoading} error={q.error}>
      {r ? (
        <PagedDocument
          header={() => <DocHeader company={r.company} title="BATCH SHEET" fields={fields} party={<LabeledLines heading="Recorded by" lines={[r.by]} />} />}
          compactHeader={(p, n) => <CompactHeader company={r.company} title="BATCH SHEET" fields={fields} page={p} pages={n} />}
          columns={[
            { label: 'Kind', width: 26 },
            { label: 'Item', width: 104 },
            { label: 'Unit', width: 20 },
            { label: 'Quantity', width: 40, align: 'right' },
          ]}
          rows={[...r.inputs.map((x) => ['Used', x.name, x.unit, formatQty(x.qty)]), ...r.outputs.map((x) => ['Made', `${x.code} ${x.name}`, x.unit, formatQty(x.qty)])]}
          tail={
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4mm' }}>
              <LabeledLines heading="Wastage" lines={[`${formatQty(r.batch.wastageQty)}`, r.batch.wastageNote]} />
              <SignatureLine label="Checked by" />
            </div>
          }
          footerNote={r.company.footerNote}
        />
      ) : null}
    </PrintScreen>
  );
}
