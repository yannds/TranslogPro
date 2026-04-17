/**
 * Carte d'embarquement 2026 — Coupon seul (partie basse du POC)
 *
 * Copie exacte de la section "TALON EMBARQUEMENT" du poc-ticket-stub.html.
 * Header ambre, grille passager/siège/trajet, QR code, visa contrôleur.
 * Format compact — idéal pour impression séparée ou scan mobile.
 */
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';
import {
  htmlProDoc, certifyPro, impBanner, escHtml, qrPng,
} from './shared-pro';

export interface BoardingPass2026Data {
  ticket: {
    id:            string;
    passengerName: string;
    seatNumber?:   string | null;
    qrToken:       string;
    boardingStationName?:  string | null;
    alightingStationName?: string | null;
  };
  trip: {
    departureScheduled: Date;
    route?: { originCity: string; destinationCity: string } | null;
    bus?:   { plateNumber: string } | null;
  };
  tenantName: string;
  actorId:    string;
  scope?:     ScopeContext;
}

function fmtDateTime(d: Date): string {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

const CSS = `
  body { padding: 0; }

  .stub-wrap {
    border: 1.5pt solid var(--c-brand); border-radius: 3pt;
    overflow: hidden; break-inside: avoid;
  }
  .stub-header {
    background: var(--c-accent); color: #fff;
    display: flex; justify-content: space-between; align-items: center;
    padding: 2mm 5mm;
  }
  .stub-header .sh-title { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
  .stub-header .sh-note  { font-size: 6.5pt; opacity: .9; }

  .stub-body {
    padding: 3mm 5mm;
    display: grid; grid-template-columns: 1fr auto;
    gap: 5mm; align-items: center;
  }
  .stub-info { display: flex; flex-direction: column; gap: 2mm; }
  .si-row { display: flex; gap: 5mm; }
  .sf { flex: 1; }
  .sf label { display: block; font-size: 6pt; text-transform: uppercase; letter-spacing: .08em; color: var(--c-muted); }
  .sf span  { font-size: 8.5pt; font-weight: 700; }
  .sf.big span { font-size: 11pt; color: var(--c-brand2); }

  .stub-qr { text-align: center; }
  .stub-qr img { width: 24mm; height: 24mm; }
  .stub-qr .mono { font-size: 5.5pt; font-family: var(--font-mono); color: var(--c-muted); }

  .stub-scan {
    border-top: 0.5pt dashed var(--c-line); margin: 2mm 5mm 0;
    padding: 2mm 0; font-size: 6.5pt; color: var(--c-muted);
    display: flex; justify-content: space-between;
  }
  .scan-box {
    border: 1pt dashed #94a3b8; border-radius: 2pt;
    width: 28mm; height: 8mm; display: flex; align-items: center;
    justify-content: center; font-size: 6pt; color: #94a3b8;
  }
`;

export async function renderBoardingPass2026(data: BoardingPass2026Data): Promise<string> {
  const { ticket, trip, tenantName, actorId, scope } = data;

  const qrSrc     = await qrPng(ticket.qrToken, 128);
  const qrImg     = qrSrc ? `<img src="${qrSrc}" alt="QR talon" width="96" height="96" />` : '';
  const ticketNum = ticket.id.slice(0, 12).toUpperCase();
  const origin    = trip.route?.originCity      ?? '—';
  const dest      = trip.route?.destinationCity ?? '—';
  const depDt     = fmtDateTime(trip.departureScheduled);
  const plate     = trip.bus?.plateNumber ?? '—';

  const body = `
${impBanner(scope)}

<!-- ═══════════════════ CARTE D'EMBARQUEMENT ═══════════════════ -->
<div class="stub-wrap">
  <div class="stub-header">
    <div class="sh-title">Coupon d'embarquement</div>
    <div class="sh-note">Ne pas séparer avant le contrôle</div>
  </div>

  <div class="stub-body">
    <div class="stub-info">
      <div class="si-row">
        <div class="sf big"><label>Passager</label><span>${escHtml(ticket.passengerName)}</span></div>
        ${ticket.seatNumber ? `<div class="sf big"><label>Siège</label><span>${escHtml(ticket.seatNumber)}</span></div>` : ''}
      </div>
      <div class="si-row">
        <div class="sf"><label>De</label><span>${escHtml(origin)}</span></div>
        <div class="sf"><label>À</label><span>${escHtml(dest)}</span></div>
        <div class="sf"><label>Départ</label><span>${depDt}</span></div>
      </div>
      <div class="si-row">
        <div class="sf"><label>N° Billet</label><span class="mono">${escHtml(ticketNum)}</span></div>
        <div class="sf"><label>Véhicule</label><span>${escHtml(plate)}</span></div>
      </div>
    </div>

    <div class="stub-qr">
      ${qrImg}
      <div class="mono">${escHtml(ticketNum)}</div>
    </div>
  </div>

  <div class="stub-scan">
    <span>\u2713 Billet valide pour ce voyage uniquement \u2014 Non remboursable</span>
    <div class="scan-box">Visa contrôleur</div>
  </div>
</div>
`;

  const raw = htmlProDoc(`Carte embarquement ${ticketNum} \u2014 ${tenantName}`, body, 'A5', CSS);
  return certifyPro(raw, actorId, scope);
}
