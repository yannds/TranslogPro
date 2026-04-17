/**
 * TicketStubRenderer — Billet de voyage style carte + talon détachable
 *
 * Visual design calqué sur le composant React TicketReceipt :
 *   ┌────────────────────────────────────────────┐
 *   │  HEADER branding (nom compagnie + classe)  │
 *   │  Bandeau route                             │
 *   │  Départ ──→ Arrivée + heure                │
 *   │  Date + Bus                                │
 *   │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
 *   │  Passager  |  QR code                      │
 *   │  Prix      |  (short ID)                   │
 *   │  ───────────────────────────────────────── │
 *   │  UUID complet          STATUT              │
 *   └────────────────────────────────────────────┘
 *   ✂ Perforation
 *   ┌────────────────────────────────────────────┐
 *   │  COUPON EMBARQUEMENT (talon compact)       │
 *   └────────────────────────────────────────────┘
 *
 * Format : A5 (148×210mm)
 */
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';
import {
  htmlProDoc, certifyPro, impBanner, perfLine, escHtml, fmtCfa, qrPng,
} from './shared-pro';

export interface TicketStubData {
  ticket: {
    id:            string;
    passengerName: string;
    seatNumber?:   string | null;
    pricePaid:     number;
    status:        string;
    qrToken:       string;
    createdAt:     Date;
    expiresAt?:    Date | null;
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
  primaryColor:   string;
  secondaryColor: string;
  actorId:        string;
  scope?:         ScopeContext;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  CONFIRMED:       { bg: '#dcfce7', fg: '#166534' },
  CHECKED_IN:      { bg: '#dcfce7', fg: '#166534' },
  BOARDED:         { bg: '#ccfbf1', fg: '#115e59' },
  COMPLETED:       { bg: '#f1f5f9', fg: '#475569' },
  PENDING_PAYMENT: { bg: '#fef9c3', fg: '#854d0e' },
  CREATED:         { bg: '#f1f5f9', fg: '#64748b' },
  CANCELLED:       { bg: '#fee2e2', fg: '#991b1b' },
  EXPIRED:         { bg: '#fee2e2', fg: '#991b1b' },
};

/* ── CSS ──────────────────────────────────────────────────────────────────── */

function buildCss(primary: string, secondary: string): string {
  return `
  :root {
    --c-primary:   ${primary};
    --c-secondary: ${secondary};
  }
  body { padding: 0; display: flex; flex-direction: column; align-items: center; }

  /* ── Ticket card ──────────────────────────────────────────── */
  .ticket-card {
    width: 100%; max-width: 380px;
    background: #fff; border-radius: 12px;
    overflow: hidden; border: 1px solid #e2e8f0;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    break-inside: avoid;
  }

  /* Header branding */
  .tc-header {
    background: var(--c-primary); color: #fff;
    padding: 16px 20px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .tc-header .brand { font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
  .tc-header .sub   { font-size: 11px; opacity: 0.85; margin-top: 2px; }
  .tc-header .class-badge {
    font-size: 11px; font-weight: 600;
    background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 20px;
  }

  /* Route banner */
  .tc-route {
    background: var(--c-secondary); color: #fff;
    padding: 8px 20px; font-size: 13px; font-weight: 600;
    text-align: center; letter-spacing: 0.3px;
  }

  /* Stations row */
  .tc-stations {
    padding: 16px 20px 8px;
    display: flex; align-items: center; gap: 12px;
  }
  .tc-station { flex: 1; text-align: center; }
  .tc-station .label {
    font-size: 11px; color: #94a3b8;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .tc-station .name { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .tc-station .stn  { font-size: 10px; color: #94a3b8; margin-top: 1px; }
  .tc-station .time { font-size: 12px; color: #64748b; margin-top: 2px; font-weight: 600; }
  .tc-arrow {
    display: flex; align-items: center; color: #cbd5e1;
  }

  /* Date + bus */
  .tc-datebus {
    text-align: center; font-size: 12px; color: #64748b;
    padding: 4px 0 12px;
  }
  .tc-datebus .plate { margin-left: 12px; font-weight: 600; }

  /* Dashed separator */
  .tc-sep { border-top: 2px dashed #e2e8f0; margin: 0 12px; }

  /* Passenger + QR area */
  .tc-body {
    padding: 16px 20px;
    display: flex; gap: 16px; align-items: flex-start;
  }
  .tc-info { flex: 1; }
  .tc-info .label {
    font-size: 11px; color: #94a3b8;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .tc-info .passenger { font-size: 15px; font-weight: 600; margin-top: 2px; }
  .tc-info .seat-row { display: flex; gap: 12px; margin-top: 8px; }
  .tc-info .seat-box {
    display: inline-flex; align-items: center; gap: 4px;
    background: #f1f5f9; border-radius: 6px; padding: 4px 10px;
  }
  .tc-info .seat-box .seat-label { font-size: 10px; color: #64748b; text-transform: uppercase; }
  .tc-info .seat-box .seat-val  { font-size: 16px; font-weight: 800; color: var(--c-primary); }
  .tc-info .price-label { margin-top: 10px; }
  .tc-info .price {
    font-size: 22px; font-weight: 800; margin-top: 2px;
    color: var(--c-primary);
  }
  .tc-info .price .unit { font-size: 13px; font-weight: 600; }

  /* QR block */
  .tc-qr { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .tc-qr img { width: 120px; height: 120px; border-radius: 6px; }
  .tc-qr .caption {
    font-size: 9px; color: #94a3b8; text-align: center;
    max-width: 120px; word-break: break-all;
    font-family: 'Courier New', monospace;
  }

  /* Footer */
  .tc-footer {
    background: #f8fafc; border-top: 1px solid #e2e8f0;
    padding: 10px 20px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 11px;
  }
  .tc-footer .id {
    font-family: 'Courier New', monospace; color: #64748b;
    max-width: 70%; word-break: break-all;
  }
  .tc-footer .status {
    font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
    padding: 2px 8px; border-radius: 4px; font-size: 10px;
  }

  /* ── Stub (boarding coupon) ──────────────────────────────── */
  .stub-card {
    width: 100%; max-width: 380px;
    background: #fff; border-radius: 12px;
    overflow: hidden; border: 1px solid #e2e8f0;
    box-shadow: 0 2px 12px rgba(0,0,0,0.05);
    break-inside: avoid; margin-top: 0;
  }
  .stub-header {
    background: var(--c-primary); color: #fff;
    padding: 10px 20px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .stub-header .title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .stub-header .note  { font-size: 10px; opacity: 0.85; }

  .stub-body {
    padding: 14px 20px;
    display: flex; gap: 14px; align-items: center;
  }
  .stub-info { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .stub-row  { display: flex; gap: 14px; }
  .stub-field .label {
    font-size: 9px; color: #94a3b8;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .stub-field .value { font-size: 12px; font-weight: 700; }
  .stub-field.big .value { font-size: 14px; color: var(--c-primary); }

  .stub-qr { flex-shrink: 0; text-align: center; }
  .stub-qr img { width: 80px; height: 80px; border-radius: 4px; }
  .stub-qr .id { font-size: 8px; font-family: 'Courier New', monospace; color: #94a3b8; margin-top: 2px; }

  .stub-footer {
    border-top: 1px dashed #e2e8f0;
    padding: 8px 20px; font-size: 10px; color: #94a3b8;
    display: flex; justify-content: space-between; align-items: center;
  }
  .stub-footer .visa-box {
    border: 1px dashed #cbd5e1; border-radius: 4px;
    width: 28mm; height: 8mm;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; color: #94a3b8;
  }

  @media print {
    body { background: #fff; }
    .ticket-card, .stub-card { box-shadow: none; }
  }
`;
}

/* ── Arrow SVG (same as TicketReceipt) ────────────────────────────────────── */

const ARROW_SVG = `<svg width="32" height="16" viewBox="0 0 32 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 8h28M24 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/* ── Main render ──────────────────────────────────────────────────────────── */

export async function renderTicketStub(data: TicketStubData): Promise<string> {
  const { ticket, trip, tenantName, tenantSlug, primaryColor, secondaryColor, actorId, scope } = data;

  const qrSrc    = await qrPng(ticket.qrToken, 160);
  const qrBig    = qrSrc ? `<img src="${qrSrc}" alt="QR billet" />` : '';
  const qrSmall  = qrSrc ? `<img src="${qrSrc}" alt="QR talon" />` : '';

  const ticketShort = ticket.id.slice(0, 12);
  const origin      = trip.route?.originCity      ?? '—';
  const dest        = trip.route?.destinationCity ?? '—';
  const routeName   = trip.route?.name            ?? null;
  const depTime     = fmtTime(trip.departureScheduled);
  const arrTime     = fmtTime(trip.arrivalScheduled);
  const depDate     = fmtDateShort(trip.departureScheduled);
  const plate       = trip.bus?.plateNumber ?? null;
  const fareClass   = ticket.class ?? 'STANDARD';
  const sc          = STATUS_COLORS[ticket.status] ?? STATUS_COLORS['CREATED'];
  const bStation    = ticket.boardingStationName  ?? null;
  const aStation    = ticket.alightingStationName ?? null;

  const body = `
${impBanner(scope)}

<!-- ═══════════════════ BILLET CARTE ═══════════════════ -->
<div class="ticket-card">

  <!-- Header branding -->
  <div class="tc-header">
    <div>
      <div class="brand">${escHtml(tenantName)}</div>
      <div class="sub">Billet de voyage</div>
    </div>
    <div class="class-badge">${escHtml(fareClass)}</div>
  </div>

  <!-- Route banner -->
  ${routeName ? `<div class="tc-route">${escHtml(routeName)}</div>` : ''}

  <!-- Stations -->
  <div class="tc-stations">
    <div class="tc-station">
      <div class="label">Départ</div>
      <div class="name">${escHtml(origin)}</div>
      ${bStation ? `<div class="stn">${escHtml(bStation)}</div>` : ''}
      ${depTime ? `<div class="time">${depTime}</div>` : ''}
    </div>
    <div class="tc-arrow">${ARROW_SVG}</div>
    <div class="tc-station">
      <div class="label">Arrivée</div>
      <div class="name">${escHtml(dest)}</div>
      ${aStation ? `<div class="stn">${escHtml(aStation)}</div>` : ''}
      ${arrTime ? `<div class="time">${arrTime}</div>` : ''}
    </div>
  </div>

  <!-- Date + Bus -->
  <div class="tc-datebus">
    ${depDate}
    ${plate ? `<span class="plate">Bus ${escHtml(plate)}</span>` : ''}
  </div>

  <!-- Dashed separator -->
  <div class="tc-sep"></div>

  <!-- Passenger + QR -->
  <div class="tc-body">
    <div class="tc-info">
      <div class="label">Passager</div>
      <div class="passenger">${escHtml(ticket.passengerName)}</div>
      ${ticket.seatNumber ? `
      <div class="seat-row">
        <div class="seat-box">
          <span class="seat-label">Siège</span>
          <span class="seat-val">${escHtml(ticket.seatNumber)}</span>
        </div>
      </div>` : ''}

      <div class="label price-label">Prix</div>
      <div class="price">${fmtCfa(ticket.pricePaid).replace('XAF', '')} <span class="unit">XAF</span></div>
    </div>

    <div class="tc-qr">
      ${qrBig}
      <div class="caption">${ticketShort}</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="tc-footer">
    <span class="id">${ticket.id}</span>
    <span class="status" style="background:${sc.bg};color:${sc.fg};">${escHtml(ticket.status)}</span>
  </div>
</div>

<!-- ═══════════════════ PERFORATION ═══════════════════ -->
${perfLine('Conserver le talon — À remettre au contrôleur')}

<!-- ═══════════════════ COUPON EMBARQUEMENT ═══════════════════ -->
<div class="stub-card">
  <div class="stub-header">
    <span class="title">Coupon d'embarquement</span>
    <span class="note">Ne pas séparer avant le contrôle</span>
  </div>

  <div class="stub-body">
    <div class="stub-info">
      <div class="stub-row">
        <div class="stub-field big"><div class="label">Passager</div><div class="value">${escHtml(ticket.passengerName)}</div></div>
        ${ticket.seatNumber ? `<div class="stub-field big"><div class="label">Siège</div><div class="value">${escHtml(ticket.seatNumber)}</div></div>` : ''}
      </div>
      <div class="stub-row">
        <div class="stub-field"><div class="label">De</div><div class="value">${escHtml(origin)}</div></div>
        <div class="stub-field"><div class="label">À</div><div class="value">${escHtml(dest)}</div></div>
        <div class="stub-field"><div class="label">Départ</div><div class="value">${depTime}</div></div>
      </div>
      <div class="stub-row">
        <div class="stub-field"><div class="label">N° Billet</div><div class="value" style="font-family:'Courier New',monospace;">${ticketShort}</div></div>
        ${plate ? `<div class="stub-field"><div class="label">Véhicule</div><div class="value">${escHtml(plate)}</div></div>` : ''}
      </div>
    </div>

    <div class="stub-qr">
      ${qrSmall}
      <div class="id">${ticketShort}</div>
    </div>
  </div>

  <div class="stub-footer">
    <span>Billet valide pour ce voyage uniquement — Non remboursable</span>
    <div class="visa-box">Visa contrôleur</div>
  </div>
</div>
`;

  const css = buildCss(primaryColor, secondaryColor);
  const raw = htmlProDoc(`Billet ${ticketShort} — ${tenantName}`, body, 'A5', css);
  return certifyPro(raw, actorId, scope);
}
