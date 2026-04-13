/**
 * InvoiceRenderer — facture conforme avec calcul des taxes
 *
 * Contenu :
 *   - En-tête transporteur + numéro de facture séquentiel
 *   - Client (passager ou expéditeur)
 *   - Tableau de facturation : description, quantité, prix unitaire HT, TVA, TTC
 *   - Récapitulatif fiscal : sous-total HT, TVA (18% — taux UEMOA par défaut), TTC
 *   - Mentions légales obligatoires
 *   - Fingerprint SHA-256
 *
 * TAUX TVA : 18% par défaut (configurable par TenantConfig).
 * Le numéro de facture est généré : {YYYYMM}-{ticketId|parcelId}.slice(0,8).toUpperCase()
 */
import { htmlDoc, certify, escHtml, fmtDate, fmtCfa, impersonationBanner } from './shared';
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';

export interface InvoiceLine {
  description: string;
  quantity:    number;
  unitPriceHt: number;
  tvaRate:     number;   // ex: 0.18
}

export interface InvoiceRenderData {
  invoiceNumber: string;
  issuedAt:      Date;
  client: {
    name:    string;
    phone:   string | null;
    address: string | null;
    email:   string | null;
  };
  seller: {
    name:    string;
    address: string | null;
    phone:   string | null;
    email:   string | null;
    nif:     string | null;  // Numéro d'identification fiscale
    rccm:    string | null;  // Registre du commerce
  };
  lines:      InvoiceLine[];
  currency:   string;     // 'FCFA'
  notes:      string | null;
  actorId:    string;
  scope:      ScopeContext | undefined;
}

export function renderInvoice(data: InvoiceRenderData): string {
  const { invoiceNumber, issuedAt, client, seller, lines, currency, notes, actorId, scope } = data;

  let totalHt  = 0;
  let totalTva = 0;
  let totalTtc = 0;

  const lineRows = lines.map(l => {
    const lineHt  = l.quantity * l.unitPriceHt;
    const lineTva = lineHt * l.tvaRate;
    const lineTtc = lineHt + lineTva;
    totalHt  += lineHt;
    totalTva += lineTva;
    totalTtc += lineTtc;

    return `
      <tr>
        <td>${escHtml(l.description)}</td>
        <td style="text-align:center;">${l.quantity}</td>
        <td style="text-align:right;">${fmtCfa(l.unitPriceHt)}</td>
        <td style="text-align:center;">${Math.round(l.tvaRate * 100)}%</td>
        <td style="text-align:right;">${fmtCfa(lineTva)}</td>
        <td style="text-align:right;font-weight:700;">${fmtCfa(lineTtc)}</td>
      </tr>`;
  }).join('');

  const body = `
${impersonationBanner(scope)}
<div class="doc-header">
  <div>
    <h1>FACTURE</h1>
    <div style="font-size:11px;font-weight:700;color:#555;margin-top:2px;">N° ${escHtml(invoiceNumber)}</div>
    <div style="font-size:10px;color:#777;">Date d'émission : ${fmtDate(issuedAt)}</div>
  </div>
  <div class="meta" style="text-align:right;">
    <strong>${escHtml(seller.name)}</strong><br>
    ${seller.address ? escHtml(seller.address) + '<br>' : ''}
    ${seller.phone   ? `Tél : ${escHtml(seller.phone)}<br>` : ''}
    ${seller.email   ? escHtml(seller.email) + '<br>' : ''}
    ${seller.nif     ? `NIF : ${escHtml(seller.nif)}<br>` : ''}
    ${seller.rccm    ? `RCCM : ${escHtml(seller.rccm)}` : ''}
  </div>
</div>

<div class="two-col" style="margin-bottom:16px;">
  <div class="section">
    <h2>Facturé à</h2>
    <div class="field"><label>Nom</label><span>${escHtml(client.name)}</span></div>
    ${client.phone   ? `<div class="field"><label>Téléphone</label><span>${escHtml(client.phone)}</span></div>` : ''}
    ${client.address ? `<div class="field"><label>Adresse</label><span>${escHtml(client.address)}</span></div>` : ''}
    ${client.email   ? `<div class="field"><label>Email</label><span>${escHtml(client.email)}</span></div>` : ''}
  </div>
  <div class="section">
    <h2>Récapitulatif</h2>
    <div class="field"><label>Facture N°</label><span>${escHtml(invoiceNumber)}</span></div>
    <div class="field"><label>Date</label><span>${fmtDate(issuedAt)}</span></div>
    <div class="field"><label>Devise</label><span>${escHtml(currency)}</span></div>
    <div class="field"><label>Montant TTC</label>
      <span style="font-size:16px;font-weight:700;color:#1a1a1a;">${fmtCfa(totalTtc)}</span>
    </div>
  </div>
</div>

<div class="section">
  <h2>Détail des prestations</h2>
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align:center;width:60px;">Qté</th>
        <th style="text-align:right;width:100px;">P.U. HT</th>
        <th style="text-align:center;width:50px;">TVA</th>
        <th style="text-align:right;width:100px;">TVA</th>
        <th style="text-align:right;width:110px;">Total TTC</th>
      </tr>
    </thead>
    <tbody>${lineRows}</tbody>
    <tfoot>
      <tr style="background:#f5f5f5;">
        <td colspan="2" style="text-align:right;font-weight:700;">Sous-total HT</td>
        <td colspan="4" style="text-align:right;">${fmtCfa(totalHt)}</td>
      </tr>
      <tr style="background:#f5f5f5;">
        <td colspan="2" style="text-align:right;font-weight:700;">TVA</td>
        <td colspan="4" style="text-align:right;">${fmtCfa(totalTva)}</td>
      </tr>
      <tr style="background:#1a1a1a;color:#fff;">
        <td colspan="2" style="text-align:right;font-weight:700;font-size:13px;">TOTAL TTC</td>
        <td colspan="4" style="text-align:right;font-weight:700;font-size:13px;">${fmtCfa(totalTtc)}</td>
      </tr>
    </tfoot>
  </table>
</div>

${notes ? `<div class="section"><h2>Notes</h2><p style="font-size:11px;">${escHtml(notes)}</p></div>` : ''}

<div style="margin-top:24px;font-size:9px;color:#888;border-top:1px dashed #ddd;padding-top:8px;">
  <strong>Mentions légales :</strong> Cette facture est soumise au droit applicable dans le pays d'émission.
  TVA appliquée conformément à la législation UEMOA en vigueur.
  En cas de litige, s'adresser à ${escHtml(seller.name)}.
  Tout paiement effectué après la date d'émission est définitif.
</div>

<div style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:40px;font-size:11px;">
  <div>
    <div style="border-top:1px solid #1a1a1a;padding-top:4px;margin-top:24px;">Cachet et Signature vendeur</div>
  </div>
  <div>
    <div style="border-top:1px solid #1a1a1a;padding-top:4px;margin-top:24px;">Signature client</div>
  </div>
</div>
`;

  const raw = htmlDoc(`Facture ${invoiceNumber} — ${escHtml(seller.name)}`, body);
  return certify(raw, actorId, scope);
}

// ─── Helper : construit une InvoiceLine depuis un ticket ────────────────────

export function ticketToInvoiceLines(
  passengerName: string,
  pricePaid:     number,
  tvaRate:       number,
  routeName:     string,
  seatNumber:    string | null,
): InvoiceLine[] {
  const htTotal = Math.round(pricePaid / (1 + tvaRate));
  return [
    {
      description: `Transport voyageur — ${routeName}${seatNumber ? ` (siège ${seatNumber})` : ''} — ${passengerName}`,
      quantity:    1,
      unitPriceHt: htTotal,
      tvaRate,
    },
  ];
}

/** Construit une InvoiceLine depuis un colis */
export function parcelToInvoiceLines(
  trackingCode: string,
  weight:       number,
  price:        number,
  tvaRate:      number,
  destination:  string,
): InvoiceLine[] {
  const htTotal = Math.round(price / (1 + tvaRate));
  return [
    {
      description: `Transport colis ${trackingCode} — Dest. ${destination} — ${weight} kg`,
      quantity:    1,
      unitPriceHt: htTotal,
      tvaRate,
    },
  ];
}
