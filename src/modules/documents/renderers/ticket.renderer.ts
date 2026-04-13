/**
 * TicketRenderer — billet voyageur avec QR Code HMAC-SHA256
 *
 * Contenu :
 *   - En-tête : transporteur, numéro de billet, date d'émission
 *   - Passager : nom, siège, classe tarifaire
 *   - Trajet : départ, destination, horaires prévus
 *   - QR Code : token HMAC signé embarqué en data-URL PNG (160×160)
 *   - Fingerprint SHA-256 du document
 *
 * Le QR est signé par QrService (HMAC-SHA256, clé Vault par tenant).
 * Un token invalide → image QR vide (le billet reste imprimable).
 */
import { htmlDoc, certify, qrDataUrl, escHtml, fmtDate, fmtCfa, impersonationBanner } from './shared';
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';

export interface TicketRenderData {
  ticket: {
    id:            string;
    tenantId:      string;
    passengerName: string;
    seatNumber:    string | null;
    pricePaid:     number;
    status:        string;
    qrToken:       string;   // token déjà signé par QrService.sign()
    createdAt:     Date;
    expiresAt:     Date | null;
  };
  trip: {
    id:                  string;
    departureScheduled:  Date;
    arrivalScheduled:    Date;
    route: { name: string; originId: string; destinationId: string } | null;
    bus:   { plateNumber: string; model: string } | null;
  };
  tenantName: string;
  actorId:    string;
  scope:      ScopeContext | undefined;
}

export async function renderTicket(data: TicketRenderData): Promise<string> {
  const { ticket, trip, tenantName, actorId, scope } = data;
  const qrSrc = await qrDataUrl(ticket.qrToken);
  const qrImg = qrSrc
    ? `<img src="${qrSrc}" alt="QR Code billet" width="160" height="160" />`
    : `<p style="color:#c00;font-size:10px;">QR non disponible</p>`;

  const body = `
${impersonationBanner(scope)}
<div class="doc-header">
  <div>
    <h1>BILLET DE VOYAGE</h1>
    <div style="font-size:10px;color:#555;margin-top:4px;">${escHtml(tenantName)}</div>
  </div>
  <div class="meta">
    N° ${escHtml(ticket.id.slice(0, 12).toUpperCase())}<br>
    Émis le ${fmtDate(ticket.createdAt)}<br>
    Statut : <strong>${escHtml(ticket.status)}</strong>
  </div>
</div>

<div class="two-col">
  <div class="section">
    <h2>Passager</h2>
    <div class="field"><label>Nom</label><span>${escHtml(ticket.passengerName)}</span></div>
    <div class="field"><label>Siège</label><span>${escHtml(ticket.seatNumber ?? 'Non attribué')}</span></div>
    <div class="field"><label>Tarif payé</label><span>${fmtCfa(ticket.pricePaid)}</span></div>
    ${ticket.expiresAt ? `<div class="field"><label>Expire le</label><span>${fmtDate(ticket.expiresAt)}</span></div>` : ''}
  </div>

  <div class="section">
    <h2>Trajet</h2>
    <div class="field"><label>Ligne</label><span>${escHtml(trip.route?.name ?? '—')}</span></div>
    <div class="field"><label>Départ prévu</label><span>${fmtDate(trip.departureScheduled)}</span></div>
    <div class="field"><label>Arrivée prévue</label><span>${fmtDate(trip.arrivalScheduled)}</span></div>
    <div class="field"><label>Véhicule</label><span>${escHtml(trip.bus?.plateNumber ?? '—')} ${escHtml(trip.bus?.model ?? '')}</span></div>
  </div>
</div>

<div class="section" style="margin-top:16px;">
  <h2>Code QR de validation</h2>
  <div class="qr-block">
    ${qrImg}
    <div class="qr-caption">Présentez ce code à l'embarquement — Ne pas dupliquer</div>
  </div>
</div>

<div class="section no-print" style="margin-top:16px;background:#f9f9f9;padding:8px;border:1px solid #eee;font-size:10px;">
  <strong>Instructions d'impression :</strong> Utilisez Ctrl+P (ou Cmd+P) et sélectionnez "Impression recto verso désactivée".
</div>
`;

  const raw = htmlDoc(`Billet ${ticket.id.slice(0, 12).toUpperCase()} — ${tenantName}`, body);
  return certify(raw, actorId, scope);
}
