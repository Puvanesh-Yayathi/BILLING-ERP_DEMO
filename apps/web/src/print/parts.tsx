import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { formatDate, type CompanyProfile } from '@app/contract';

/** Shared blocks for every document so printed stacks look like one family. */

export function logoUrl(c: CompanyProfile): string | undefined {
  return c.logoAssetId ? `/api/v1/assets/${c.logoAssetId}` : undefined;
}

export function CompanyBlock({ c, compact }: { c: CompanyProfile; compact?: boolean }) {
  const logo = logoUrl(c);
  return (
    <div style={{ display: 'flex', gap: '3mm', alignItems: 'flex-start', minWidth: 0 }}>
      <img src={logo ?? '/mark.svg'} alt="" style={{ width: compact ? '12mm' : '22mm', height: compact ? '12mm' : '22mm', objectFit: 'contain' }} />
      <div style={{ minWidth: 0 }}>
        <div className="doc-company">{c.brandName}</div>
        {c.legalName && !compact ? <div className="doc-value">{c.legalName}</div> : null}
        {!compact ? (
          <>
            <div className="doc-value">
              {c.addressLine1}
              {c.addressLine2 ? `, ${c.addressLine2}` : ''}
            </div>
            <div className="doc-value">
              {c.city}, {c.state} {c.pincode} (State code {c.stateCode})
            </div>
            <div className="doc-value">
              {c.phone}, {c.email}
              {c.website ? `, ${c.website}` : ''}
            </div>
          </>
        ) : null}
        <div className="doc-value">{c.gstin ? `GSTIN ${c.gstin}` : 'GSTIN not registered'}</div>
      </div>
    </div>
  );
}

export function TitleBlock({ title, fields, extra }: { title: string; fields: [string, ReactNode][]; extra?: ReactNode }) {
  return (
    <div style={{ textAlign: 'right', minWidth: '62mm' }}>
      <div className="doc-title">{title}</div>
      {extra}
      <table style={{ marginLeft: 'auto', marginTop: '1.5mm', borderCollapse: 'collapse' }}>
        <tbody>
          {fields.map(([k, v]) => (
            <tr key={k}>
              <td className="doc-label" style={{ paddingRight: '3mm', textAlign: 'right' }}>
                {k}
              </td>
              <td className="doc-value" style={{ textAlign: 'right', fontWeight: 500 }}>
                {v}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocHeader({ company, title, fields, extra, party }: { company: CompanyProfile; title: string; fields: [string, ReactNode][]; extra?: ReactNode; party?: ReactNode }) {
  return (
    <div>
      <div className="doc-rule" style={{ display: 'flex', justifyContent: 'space-between', gap: '6mm', paddingBottom: '3mm' }}>
        <CompanyBlock c={company} />
        <TitleBlock title={title} fields={fields} extra={extra} />
      </div>
      {party ? <div style={{ padding: '3mm 0 3mm' }}>{party}</div> : <div style={{ height: '3mm' }} />}
    </div>
  );
}

export function CompactHeader({ company, title, fields, page, pages }: { company: CompanyProfile; title: string; fields: [string, ReactNode][]; page: number; pages: number }) {
  return (
    <div className="doc-rule" style={{ display: 'flex', justifyContent: 'space-between', gap: '6mm', paddingBottom: '2mm', marginBottom: '3mm' }}>
      <CompanyBlock c={company} compact />
      <TitleBlock title={title} fields={[...fields, ['Page', `${page} of ${pages}`]]} />
    </div>
  );
}

/** Two equal columns separated by a hairline. */
export function PartyColumns({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      <div style={{ paddingRight: '4mm', borderRight: '0.2mm solid #DCE2EA' }}>{left}</div>
      <div style={{ paddingLeft: '4mm' }}>{right}</div>
    </div>
  );
}

export function LabeledLines({ heading, lines }: { heading: string; lines: (ReactNode | null | undefined | false)[] }) {
  return (
    <div>
      <div className="doc-label" style={{ marginBottom: '0.8mm' }}>
        {heading}
      </div>
      {lines.filter(Boolean).map((l, i) => (
        <div key={i} className="doc-value" style={i === 0 ? { fontWeight: 600 } : undefined}>
          {l}
        </div>
      ))}
    </div>
  );
}

export function KV({ rows, width = '80mm' }: { rows: [ReactNode, ReactNode, boolean?][]; width?: string }) {
  return (
    <table style={{ width, borderCollapse: 'collapse' }}>
      <tbody>
        {rows.map(([k, v, strong], i) => (
          <tr key={i} style={strong ? { borderTop: '0.4mm solid #0F2A47' } : { borderBottom: '0.2mm solid #DCE2EA' }}>
            <td className={strong ? 'doc-grand' : 'doc-label'} style={{ padding: '1.2mm 0', color: strong ? '#000000' : undefined }}>
              {k}
            </td>
            <td className={strong ? 'doc-grand num' : 'doc-value num'} style={{ padding: '1.2mm 0', textAlign: 'right' }}>
              {v}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Signatory({ label, brand }: { label: string; brand: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="doc-value">For {brand}</div>
      <div style={{ height: '14mm' }} />
      <div className="doc-label" style={{ borderTop: '0.2mm solid #DCE2EA', paddingTop: '1mm', display: 'inline-block', minWidth: '45mm' }}>
        {label}
      </div>
    </div>
  );
}

export function SignatureLine({ label }: { label: string }) {
  return (
    <div>
      <div style={{ height: '14mm' }} />
      <div className="doc-label" style={{ borderTop: '0.2mm solid #DCE2EA', paddingTop: '1mm', minWidth: '50mm', display: 'inline-block' }}>
        {label}
      </div>
    </div>
  );
}

export function Qr({ text, size = 28 }: { text: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toDataURL(text, { margin: 0, width: 400, color: { dark: '#000000', light: '#FFFFFF' } }).then(setSrc);
  }, [text]);
  return src ? <img src={src} alt="UPI payment QR code" style={{ width: `${size}mm`, height: `${size}mm` }} /> : <div style={{ width: `${size}mm`, height: `${size}mm` }} />;
}

export const d = (s?: string | null) => (s ? formatDate(s) : '');
