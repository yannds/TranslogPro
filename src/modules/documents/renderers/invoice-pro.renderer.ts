/**
 * InvoiceProRenderer — Facture PDF Haute-Fidélité (POC Carbone parity)
 *
 * Rendu Puppeteer A4 avec :
 *   - En-tête transporteur (logo zone + coordonnées complètes)
 *   - Bloc CLIENT ↔ VENDEUR (two-column)
 *   - Tableau de facturation : Description | Qté | P.U. HT | TVA% | TVA | TTC
 *   - Récapitulatif fiscal (sous-total HT, TVA, TOTAL TTC) en box sombre
 *   - Mentions de paiement + RIB/coordonnées bancaires
 *   - Ligne de perforation → TALON DÉTACHABLE (coupon retour paiement)
 *   - Fingerprint SHA-256 en pied de page
 *
 * Talon détachable :
 *   Le coupon bas de page (séparé par perforation) contient :
 *   N° Facture | Client | Montant TTC | Date d'échéance
 *   → "À retourner avec votre règlement"
 */
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';
import {
  htmlProDoc, certifyPro, impBanner, perfLine, escHtml, fmtDate, fmtCfa, qrPng,
} from './shared-pro';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvoiceProLine {
  description: string;
  quantity:    number;
  unitPriceHt: number;
  tvaRate:     number;
}

export interface InvoiceProData {
  invoiceNumber: string;
  issuedAt:      Date;
  dueAt?:        Date | null;
  client: {
    name:    string;
    phone?:  string | null;
    address?: string | null;
    email?:  string | null;
    taxId?:  string | null;
  };
  seller: {
    name:    string;
    address?: string | null;
    phone?:  string | null;
    email?:  string | null;
    nif?:    string | null;
    rccm?:   string | null;
    bank?:   string | null;
    iban?:   string | null;
  };
  lines:      InvoiceProLine[];
  currency:   string;
  notes?:     string | null;
  actorId:    string;
  scope?:     ScopeContext;
}

// ─── Renderer ────────────────────────────────────────────────────────────────

const CSS = `
  body { padding: 0; }

  /* ── En-tête ────────────────────────────────────────────────── */
  .inv-header {
    display: grid; grid-template-columns: 1fr auto; gap: 8mm;
    align-items: start; padding-bottom: 5mm;
    border-bottom: 3pt solid var(--c-brand);
    margin-bottom: 6mm;
  }
  .inv-company { }
  .inv-company .name {
    font-size: 18pt; font-weight: 700; color: var(--c-brand2);
    letter-spacing: -.3pt; line-height: 1.1;
  }
  .inv-company .coords { font-size: 8pt; color: var(--c-muted); margin-top: 2mm; line-height: 1.7; }
  .inv-meta {
    text-align: right; background: var(--c-brand); color: #fff;
    padding: 5mm 6mm; border-radius: 2pt; min-width: 52mm;
  }
  .inv-meta .label  { font-size: 7pt; text-transform: uppercase; letter-spacing: .1em; opacity: .7; }
  .inv-meta .number { font-size: 14pt; font-weight: 700; margin: 1mm 0; }
  .inv-meta .date   { font-size: 8pt; opacity: .85; }

  /* ── Bloc client/vendeur ───────────────────────────────────── */
  .inv-parties {
    display: grid; grid-template-columns: 1fr 1fr; gap: 6mm;
    margin-bottom: 6mm;
  }
  .inv-party {
    border: 0.5pt solid var(--c-line); border-radius: 2pt; padding: 4mm;
  }
  .inv-party .party-title {
    font-size: 7pt; text-transform: uppercase; letter-spacing: .1em;
    color: var(--c-muted); margin-bottom: 2mm; font-weight: 700;
  }
  .inv-party .party-name  { font-size: 10.5pt; font-weight: 700; margin-bottom: 1mm; }
  .inv-party .party-info  { font-size: 8pt; line-height: 1.7; color: var(--c-muted); }

  /* ── Tableau facture ──────────────────────────────────────── */
  .inv-table { margin-bottom: 5mm; }
  .inv-table table { font-size: 8.5pt; }
  .inv-table th {
    background: var(--c-brand); color: #fff; padding: 2.5mm 3mm;
    font-size: 7.5pt; text-transform: uppercase; letter-spacing: .06em;
  }
  .inv-table td { padding: 2.5mm 3mm; border-bottom: 0.5pt solid var(--c-line); }
  .inv-table tr:last-child td { border-bottom: none; }

  /* ── Récapitulatif ──────────────────────────────────────── */
  .inv-totals {
    display: flex; justify-content: flex-end; margin-bottom: 6mm;
  }
  .inv-totals-box {
    width: 72mm; border: 0.5pt solid var(--c-line); border-radius: 2pt;
    overflow: hidden;
  }
  .tot-row {
    display: flex; justify-content: space-between;
    padding: 2mm 3.5mm; font-size: 8.5pt;
    border-bottom: 0.5pt solid var(--c-line);
  }
  .tot-row:last-child { border-bottom: none; }
  .tot-row.ttc {
    background: var(--c-brand); color: #fff;
    font-size: 11pt; font-weight: 700;
    padding: 3mm 3.5mm;
  }

  /* ── Paiement ───────────────────────────────────────────── */
  .inv-payment {
    border-left: 3pt solid var(--c-accent);
    padding: 3mm 4mm; margin-bottom: 6mm;
    font-size: 8pt; background: #fffbeb;
    border-radius: 0 2pt 2pt 0;
  }
  .inv-payment .pay-title { font-weight: 700; margin-bottom: 1.5mm; font-size: 9pt; }
  .inv-payment .pay-bank  { font-family: var(--font-mono); color: var(--c-brand2); font-size: 8pt; }

  /* ── Notes ──────────────────────────────────────────────── */
  .inv-notes {
    font-size: 7.5pt; color: var(--c-muted);
    border-top: 0.5pt dashed var(--c-line); padding-top: 3mm; margin-bottom: 4mm;
  }

  /* ── Mentions légales ────────────────────────────────────── */
  .inv-legal {
    font-size: 6.5pt; color: #94a3b8; text-align: center;
    border-top: 0.5pt solid var(--c-line); padding-top: 2mm;
  }

  /* ── Talon ───────────────────────────────────────────────── */
  .inv-stub {
    border: 1pt solid var(--c-line); border-radius: 3pt;
    padding: 4mm 5mm; margin-top: 2mm;
    display: grid; grid-template-columns: 1fr auto;
    gap: 6mm; align-items: center;
    break-inside: avoid;
  }
  .stub-title {
    font-size: 7pt; text-transform: uppercase; letter-spacing: .1em;
    color: var(--c-muted); margin-bottom: 1.5mm; font-weight: 700;
  }
  .stub-fields { display: flex; flex-direction: column; gap: 1mm; font-size: 8.5pt; }
  .stub-field  { display: flex; gap: 3mm; align-items: baseline; }
  .stub-field label { font-size: 7pt; color: var(--c-muted); min-width: 26mm; }
  .stub-field span  { font-weight: 700; }
  .stub-qr { text-align: center; }
  .stub-qr img { width: 22mm; height: 22mm; }
  .stub-qr .mono { font-size: 6pt; margin-top: 1mm; }
  .stub-note {
    grid-column: 1 / -1; font-size: 7pt; color: var(--c-muted);
    font-style: italic; padding-top: 2mm;
    border-top: 0.5pt dashed var(--c-line);
  }
`;

export async function renderInvoicePro(data: InvoiceProData): Promise<string> {
  const { invoiceNumber, issuedAt, dueAt, client, seller, lines, currency, notes, actorId, scope } = data;

  // ── Calculs TVA ──────────────────────────────────────────────────────────
  let totalHt = 0, totalTva = 0, totalTtc = 0;
  const lineRows = lines.map(l => {
    const ht  = l.quantity * l.unitPriceHt;
    const tva = ht * l.tvaRate;
    const ttc = ht + tva;
    totalHt  += ht; totalTva += tva; totalTtc += ttc;
    return [
      escHtml(l.description),
      String(l.quantity),
      fmtCfa(l.unitPriceHt),
      `${Math.round(l.tvaRate * 100)}%`,
      fmtCfa(Math.round(tva)),
      `<strong>${fmtCfa(Math.round(ttc))}</strong>`,
    ];
  });

  // ── QR coupon ────────────────────────────────────────────────────────────
  const qrSrc = await qrPng(invoiceNumber, 88);
  const qrImg = qrSrc ? `<img src="${qrSrc}" alt="QR facture" />` : '';

  const dueLabel = dueAt ? fmtDate(dueAt) : '—';

  // ── Corps ────────────────────────────────────────────────────────────────
  const body = `
${impBanner(scope)}

<!-- ═══ EN-TÊTE ═══ -->
<div class="inv-header">
  <div class="inv-company">
    <div class="name">${escHtml(seller.name)}</div>
    <div class="coords">
      ${seller.address ? escHtml(seller.address) + '<br>' : ''}
      ${seller.phone   ? 'Tél : ' + escHtml(seller.phone) + '<br>' : ''}
      ${seller.email   ? escHtml(seller.email) + '<br>' : ''}
      ${seller.nif     ? 'NIF : ' + escHtml(seller.nif) + '<br>' : ''}
      ${seller.rccm    ? 'RCCM : ' + escHtml(seller.rccm) : ''}
    </div>
  </div>
  <div class="inv-meta">
    <div class="label">Facture</div>
    <div class="number">${escHtml(invoiceNumber)}</div>
    <div class="date">Émise le ${fmtDate(issuedAt)}</div>
    ${dueAt ? `<div class="date" style="margin-top:1mm;">Échéance ${fmtDate(dueAt)}</div>` : ''}
  </div>
</div>

<!-- ═══ PARTIES ═══ -->
<div class="inv-parties">
  <div class="inv-party">
    <div class="party-title">Facturé à</div>
    <div class="party-name">${escHtml(client.name)}</div>
    <div class="party-info">
      ${client.address ? escHtml(client.address) + '<br>' : ''}
      ${client.phone   ? 'Tél : ' + escHtml(client.phone) + '<br>' : ''}
      ${client.email   ? escHtml(client.email) + '<br>' : ''}
      ${client.taxId   ? 'NIF : ' + escHtml(client.taxId) : ''}
    </div>
  </div>
  <div class="inv-party">
    <div class="party-title">Récapitulatif</div>
    <div class="party-info" style="font-size:8.5pt;">
      <strong>N° Facture</strong> ${escHtml(invoiceNumber)}<br>
      <strong>Date</strong> ${fmtDate(issuedAt)}<br>
      <strong>Devise</strong> ${escHtml(currency)}<br>
      ${dueAt ? `<strong>Échéance</strong> ${fmtDate(dueAt)}<br>` : ''}
      <strong style="font-size:11pt;color:var(--c-brand);">Total TTC</strong>
      <span style="font-size:11pt;font-weight:700;">${fmtCfa(Math.round(totalTtc))}</span>
    </div>
  </div>
</div>

<!-- ═══ TABLEAU PRESTATIONS ═══ -->
<div class="inv-table">
  <table>
    <thead>
      <tr>
        <th style="width:44%">Description</th>
        <th style="text-align:center;width:8%">Qté</th>
        <th style="text-align:right;width:14%">P.U. HT</th>
        <th style="text-align:center;width:8%">TVA</th>
        <th style="text-align:right;width:12%">TVA</th>
        <th style="text-align:right;width:14%">Total TTC</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows.map(r =>
        `<tr>${r.map((v, i) => `<td style="text-align:${[1,3].includes(i)?'center':[2,4,5].includes(i)?'right':'left'}">${v}</td>`).join('')}</tr>`
      ).join('')}
    </tbody>
  </table>
</div>

<!-- ═══ TOTAUX ═══ -->
<div class="inv-totals">
  <div class="inv-totals-box">
    <div class="tot-row"><span>Sous-total HT</span><span>${fmtCfa(Math.round(totalHt))}</span></div>
    <div class="tot-row"><span>TVA</span><span>${fmtCfa(Math.round(totalTva))}</span></div>
    <div class="tot-row ttc"><span>TOTAL TTC</span><span>${fmtCfa(Math.round(totalTtc))}</span></div>
  </div>
</div>

<!-- ═══ PAIEMENT ═══ -->
${seller.bank || seller.iban ? `
<div class="inv-payment">
  <div class="pay-title">Informations de paiement</div>
  ${seller.bank ? `<div>Banque : <span class="pay-bank">${escHtml(seller.bank)}</span></div>` : ''}
  ${seller.iban ? `<div>IBAN / Compte : <span class="pay-bank">${escHtml(seller.iban)}</span></div>` : ''}
</div>` : ''}

<!-- ═══ NOTES ═══ -->
${notes ? `<div class="inv-notes"><strong>Notes :</strong> ${escHtml(notes)}</div>` : ''}

<!-- ═══ SIGNATURES ═══ -->
<div class="sig-row" style="margin-top:8mm;">
  <div class="sig-line">Cachet &amp; Signature vendeur</div>
  <div class="sig-line">Signature client</div>
</div>

<!-- ═══ MENTIONS LÉGALES ═══ -->
<div class="inv-legal" style="margin-top:6mm;">
  TVA appliquée conformément à la législation UEMOA. En cas de litige : ${escHtml(seller.name)}.
  Tout paiement après émission est définitif.
</div>

<!-- ═══════════════════════════════════════════════════
     TALON DÉTACHABLE — à retourner avec le règlement
     ══════════════════════════════════════════════════ -->
${perfLine('Détacher et retourner avec votre règlement')}

<div class="inv-stub">
  <div>
    <div class="stub-title">Coupon de paiement</div>
    <div class="stub-fields">
      <div class="stub-field"><label>N° Facture</label><span class="mono">${escHtml(invoiceNumber)}</span></div>
      <div class="stub-field"><label>Client</label><span>${escHtml(client.name)}</span></div>
      <div class="stub-field"><label>Montant TTC</label><span>${fmtCfa(Math.round(totalTtc))}</span></div>
      <div class="stub-field"><label>Échéance</label><span>${dueLabel}</span></div>
      <div class="stub-field"><label>Devise</label><span>${escHtml(currency)}</span></div>
    </div>
  </div>
  <div class="stub-qr">
    ${qrImg}
    <div class="mono">${escHtml(invoiceNumber)}</div>
  </div>
  <div class="stub-note">
    Merci de mentionner le numéro de facture sur votre virement. — ${escHtml(seller.name)}
  </div>
</div>
`;

  const raw = htmlProDoc(`Facture ${invoiceNumber} — ${seller.name}`, body, 'A4', CSS);
  return certifyPro(raw, actorId, scope);
}
