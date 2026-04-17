/**
 * Ticket 2026 — Billet A5 avec coupon détachable
 *
 * Copie exacte du POC poc-ticket-stub.html (partie billet principal).
 * Format A5, palette slate/brand2/accent, polices Helvetica/Courier.
 */
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';
import {
  htmlProDoc, certifyPro, impBanner, perfLine, escHtml, fmtCfa, qrPng,
} from './shared-pro';

export interface Ticket2026Data {
  ticket: {
    id:            string;
    passengerName: string;
    seatNumber?:   string | null;
    pricePaid:     number;
    status:        string;
    qrToken:       string;
    createdAt:     Date;
    class?:        string | null;
    boardingStationName?:  string | null;
    alightingStationName?: string | null;
  };
  trip: {
    id:                 string;
    departureScheduled: Date;
    arrivalScheduled:   Date;
    route?: { name: string; originCity: string; destinationCity: string } | null;
    bus?:   { plateNumber: string; model: string } | null;
  };
  tenantName:     string;
  tenantSlug:     string;
  primaryColor?:  string;
  secondaryColor?: string;
  actorId:        string;
  scope?:         ScopeContext;
}

function fmtDateTime(d: Date): string {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

const STATUS_BADGE: Record<string, { bg: string; fg: string }> = {
  CONFIRMED:       { bg: '#dcfce7', fg: '#166534' },
  CHECKED_IN:      { bg: '#dcfce7', fg: '#166534' },
  BOARDED:         { bg: '#ccfbf1', fg: '#115e59' },
  COMPLETED:       { bg: '#f1f5f9', fg: '#475569' },
  PENDING_PAYMENT: { bg: '#fef9c3', fg: '#854d0e' },
  CREATED:         { bg: '#f1f5f9', fg: '#64748b' },
  CANCELLED:       { bg: '#fee2e2', fg: '#991b1b' },
  EXPIRED:         { bg: '#fee2e2', fg: '#991b1b' },
};

const CSS = `
  body { padding: 0; }

  /* ── Billet principal ──────────────────────────────────────── */
  .ticket-wrap {
    border: 1.5pt solid var(--c-brand);
    border-radius: 3pt;
    overflow: hidden;
    break-inside: avoid;
  }

  /* Header sombre */
  .ticket-header {
    background: var(--c-brand); color: #fff;
    display: flex; justify-content: space-between; align-items: center;
    padding: 3mm 5mm;
  }
  .ticket-header .company { font-size: 11pt; font-weight: 700; letter-spacing: -.2pt; }
  .ticket-header .doctype { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .12em; opacity: .8; }
  .ticket-header .number  { font-size: 8pt; font-family: var(--font-mono); opacity: .9; }

  /* Accent route */
  .ticket-route {
    background: var(--c-brand2); color: #fff;
    display: flex; justify-content: space-between; align-items: center;
    padding: 2.5mm 5mm;
  }
  .ticket-route .city    { font-size: 13pt; font-weight: 700; }
  .ticket-route .arrow   { font-size: 16pt; color: var(--c-accent); }
  .ticket-route .subinfo { font-size: 7pt; opacity: .8; margin-top: 0.5mm; }

  /* Corps principal */
  .ticket-body {
    padding: 4mm 5mm; display: grid; grid-template-columns: 1fr auto; gap: 5mm; align-items: start;
  }
  .ticket-fields { display: flex; flex-direction: column; gap: 2mm; }
  .tf-row { display: flex; gap: 4mm; }
  .tf {
    flex: 1; border-bottom: 0.5pt solid var(--c-line); padding-bottom: 1.5mm;
  }
  .tf label { display: block; font-size: 6.5pt; text-transform: uppercase; letter-spacing: .08em; color: var(--c-muted); margin-bottom: 0.5mm; }
  .tf span  { font-size: 9pt; font-weight: 700; }
  .tf.seat span { font-size: 14pt; color: var(--c-brand2); }
  .tf.class span {
    font-size: 7.5pt; font-weight: 700; padding: 1pt 5pt;
    background: var(--c-accent); color: #fff; border-radius: 2pt;
  }

  /* QR zone */
  .ticket-qr { text-align: center; }
  .ticket-qr img { width: 32mm; height: 32mm; }
  .ticket-qr .caption {
    font-size: 6pt; color: var(--c-muted); margin-top: 1mm;
    font-family: var(--font-mono);
  }

  /* Prix */
  .ticket-price {
    border-top: 0.5pt solid var(--c-line);
    padding: 2.5mm 5mm;
    display: flex; justify-content: space-between; align-items: center;
  }
  .ticket-price .label { font-size: 7.5pt; color: var(--c-muted); }
  .ticket-price .amount { font-size: 12pt; font-weight: 700; color: var(--c-brand2); }
  .ticket-price .status {
    font-size: 7pt; padding: 1pt 5pt; border-radius: 2pt;
    font-weight: 700;
  }

  /* ── Talon ─────────────────────────────────────────────────── */
  .stub-wrap {
    border: 1.5pt solid var(--c-brand); border-radius: 3pt;
    overflow: hidden; break-inside: avoid; margin-top: 0;
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

export async function renderTicket2026(data: Ticket2026Data): Promise<string> {
  const { ticket, trip, tenantName, actorId, scope } = data;

  const qrSrc     = await qrPng(ticket.qrToken, 160);
  const qrBig     = qrSrc ? `<img src="${qrSrc}" alt="QR billet" />` : '';
  const qrSmall   = qrSrc ? `<img src="${qrSrc}" alt="QR talon" width="96" height="96" />` : '';
  const ticketNum = ticket.id.slice(0, 12).toUpperCase();
  const origin    = trip.route?.originCity      ?? '—';
  const dest      = trip.route?.destinationCity ?? '—';
  const routeName = trip.route?.name            ?? `${origin} — ${dest}`;
  const depDt     = fmtDateTime(trip.departureScheduled);
  const arrDt     = fmtDateTime(trip.arrivalScheduled);
  const plate     = trip.bus?.plateNumber ?? '—';
  const fareClass = ticket.class ?? 'ECONOMY';
  const sc        = STATUS_BADGE[ticket.status] ?? STATUS_BADGE['CREATED'];
  const issuedDt  = fmtDateTime(ticket.createdAt);
  const depTime   = fmtTime(trip.departureScheduled);

  const body = `
${impBanner(scope)}

<!-- ═══════════════════ BILLET PRINCIPAL ═══════════════════ -->
<div class="ticket-wrap">

  <!-- Header sombre -->
  <div class="ticket-header">
    <div>
      <div class="company">${escHtml(tenantName)}</div>
      <div class="doctype">Billet de Voyage</div>
    </div>
    <div class="number">N° ${escHtml(ticketNum)}</div>
  </div>

  <!-- Route accent -->
  <div class="ticket-route">
    <div>
      <div class="city">${escHtml(origin)}</div>
      <div class="subinfo">${depDt}</div>
    </div>
    <div class="arrow">\u2192</div>
    <div style="text-align:right;">
      <div class="city">${escHtml(dest)}</div>
      <div class="subinfo">Arr. ${arrDt}</div>
    </div>
  </div>

  <!-- Corps -->
  <div class="ticket-body">
    <div class="ticket-fields">
      <!-- Passager + Siège -->
      <div class="tf-row">
        <div class="tf" style="flex:2;">
          <label>Passager</label>
          <span>${escHtml(ticket.passengerName)}</span>
        </div>
        ${ticket.seatNumber ? `<div class="tf seat">
          <label>Siège</label>
          <span>${escHtml(ticket.seatNumber)}</span>
        </div>` : ''}
        <div class="tf class">
          <label>Classe</label>
          <span>${escHtml(fareClass)}</span>
        </div>
      </div>
      <!-- Ligne + Bus -->
      <div class="tf-row">
        <div class="tf" style="flex:2;">
          <label>Ligne</label>
          <span>${escHtml(routeName)}</span>
        </div>
        <div class="tf">
          <label>Véhicule</label>
          <span>${escHtml(plate)}</span>
        </div>
      </div>
      <!-- Émission -->
      <div class="tf-row">
        <div class="tf">
          <label>Émis le</label>
          <span>${issuedDt}</span>
        </div>
      </div>
    </div>

    <!-- QR code -->
    <div class="ticket-qr">
      ${qrBig}
      <div class="caption">Présenter à l'embarquement<br>${escHtml(ticketNum)}</div>
    </div>
  </div>

  <!-- Prix + statut -->
  <div class="ticket-price">
    <div>
      <div class="label">Tarif payé</div>
      <div class="amount">${fmtCfa(ticket.pricePaid)}</div>
    </div>
    <div class="status" style="background:${sc.bg};color:${sc.fg};">${escHtml(ticket.status)}</div>
  </div>
</div>

<!-- ═══════════════════ PERFORATION ═══════════════════ -->
${perfLine('Conserver le talon \u2014 À remettre au contrôleur')}

<!-- ═══════════════════ TALON EMBARQUEMENT ═══════════════════ -->
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
      ${qrSmall}
      <div class="mono">${escHtml(ticketNum)}</div>
    </div>
  </div>

  <div class="stub-scan">
    <span>\u2713 Billet valide pour ce voyage uniquement \u2014 Non remboursable</span>
    <div class="scan-box">Visa contrôleur</div>
  </div>
</div>
`;

  const raw = htmlProDoc(`Billet ${ticketNum} \u2014 ${tenantName}`, body, 'A5', CSS);
  return certifyPro(raw, actorId, scope);
}
