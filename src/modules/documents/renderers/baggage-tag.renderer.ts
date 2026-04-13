/**
 * BaggageTagRenderer — Talon bagage physique avec QR de tracking
 *
 * Format : 99×210mm (bande verticale, standard IATA-like)
 *
 * Structure :
 *   ┌──────────────────────────┐
 *   │  LOGO TRANSPORTEUR       │
 *   │  Référence              │
 *   ├──────────────────────────┤
 *   │  QR CODE TRACKING (gros) │
 *   │  Code texte sous le QR   │
 *   ├──────────────────────────┤
 *   │  PASSAGER                │
 *   │  TRAJET (origine → dest) │
 *   │  Date | Vol/Trajet       │
 *   ├──────────────────────────┤
 *   │  Poids | Colis N° X/Y   │
 *   │  Description             │
 *   ├── ✂ Perforation ─────── ┤
 *   │  COUPON (petit résumé)   │
 *   │  QR identique (mini)     │
 *   └──────────────────────────┘
 *
 * Puppeteer : PrintFormat = 'BAGGAGE_TAG'
 */
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';
import {
  htmlProDoc, certifyPro, impBanner, perfLine, escHtml, fmtDate, qrPng,
} from './shared-pro';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BaggageTagData {
  tag: {
    trackingCode:   string;   // Ex: "TRANSLOG-TKT-001-BAG-1"
    weight:         number;   // kg
    bagNumber:      number;   // N° dans la série : 1
    totalBags:      number;   // Total bagages du passager : 2
    description?:  string | null; // "Valise 24 pouces rouge"
  };
  passenger: {
    name:    string;
    phone?:  string | null;
    ticketId?: string | null;
  };
  trip: {
    id:                  string;
    departureScheduled:  Date;
    origin:              string;  // Ville ou code agence
    destination:         string;
    routeName?:          string | null;
    busPlate?:           string | null;
  };
  tenantName: string;
  actorId:    string;
  scope?:     ScopeContext;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
  body { padding: 0; }

  /* ── Conteneur principal ─────────────────────────────────── */
  .bag-tag {
    width: 100%;
    border: 2pt solid var(--c-brand);
    border-radius: 3pt;
    overflow: hidden;
    font-size: 9pt;
  }

  /* ── Header transporteur ─────────────────────────────────── */
  .bag-header {
    background: var(--c-brand);
    color: #fff;
    padding: 4mm 5mm 3mm;
    text-align: center;
  }
  .bag-header .tenant-name {
    font-size: 13pt; font-weight: 700; letter-spacing: -.3pt; line-height: 1.1;
  }
  .bag-header .ref {
    font-size: 7pt; letter-spacing: .12em; text-transform: uppercase;
    opacity: .75; margin-top: 1mm;
  }

  /* ── QR principal ────────────────────────────────────────── */
  .bag-qr-zone {
    background: #fff; padding: 5mm 4mm 2mm;
    display: flex; flex-direction: column; align-items: center; gap: 2mm;
    border-bottom: 1pt solid var(--c-line);
  }
  .bag-qr-zone img {
    width: 62mm; height: 62mm;
    border: 1pt solid var(--c-line);
  }
  .bag-tracking {
    font-family: var(--font-mono); font-size: 8.5pt; font-weight: 700;
    color: var(--c-brand2); text-align: center; letter-spacing: .04em;
    word-break: break-all;
  }

  /* ── Infos passager ──────────────────────────────────────── */
  .bag-section {
    padding: 3.5mm 4mm;
    border-bottom: 0.5pt solid var(--c-line);
  }
  .bag-section:last-child { border-bottom: none; }
  .bag-label {
    font-size: 6.5pt; text-transform: uppercase; letter-spacing: .1em;
    color: var(--c-muted); font-weight: 700; margin-bottom: 0.5mm;
  }
  .bag-value {
    font-size: 10pt; font-weight: 700; color: var(--c-brand);
  }
  .bag-value-sm {
    font-size: 8.5pt; font-weight: 400; color: var(--c-muted);
  }

  /* ── Trajet (accent band) ────────────────────────────────── */
  .bag-route {
    background: var(--c-brand2); color: #fff;
    padding: 3mm 4mm;
    display: flex; align-items: center; justify-content: space-between; gap: 3mm;
  }
  .bag-route .city {
    font-size: 14pt; font-weight: 700; letter-spacing: -.3pt; line-height: 1;
  }
  .bag-route .arrow {
    font-size: 16pt; opacity: .6; flex-shrink: 0;
  }
  .bag-route .city-label {
    font-size: 6.5pt; opacity: .7; text-transform: uppercase; letter-spacing: .08em;
  }

  /* ── Poids / N° colis ────────────────────────────────────── */
  .bag-weight-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 3mm 4mm; background: #f8fafc; border-bottom: 0.5pt solid var(--c-line);
  }
  .bag-weight-badge {
    background: var(--c-accent); color: #fff;
    font-size: 11pt; font-weight: 700;
    padding: 1mm 3mm; border-radius: 2pt;
  }
  .bag-num {
    font-size: 9pt; font-weight: 700; color: var(--c-brand2);
  }
  .bag-num .total {
    font-weight: 400; color: var(--c-muted);
  }

  /* ── Coupon talon ────────────────────────────────────────── */
  .bag-stub {
    padding: 3mm 4mm;
    display: flex; align-items: center; justify-content: space-between; gap: 3mm;
    break-inside: avoid;
  }
  .bag-stub .stub-info { flex: 1; min-width: 0; }
  .bag-stub .stub-info .stub-label {
    font-size: 6pt; text-transform: uppercase; letter-spacing: .1em;
    color: var(--c-muted); font-weight: 700; margin-bottom: 0.5mm;
  }
  .bag-stub .stub-code {
    font-family: var(--font-mono); font-size: 7pt; color: var(--c-brand2);
    word-break: break-all;
  }
  .bag-stub img {
    width: 18mm; height: 18mm; flex-shrink: 0;
    border: 0.5pt solid var(--c-line);
  }
`;

// ─── Renderer ────────────────────────────────────────────────────────────────

export async function renderBaggageTag(data: BaggageTagData): Promise<string> {
  const { tag, passenger, trip, tenantName, actorId, scope } = data;

  const qrBig  = await qrPng(tag.trackingCode, 250);
  const qrMini = await qrPng(tag.trackingCode, 80);

  const qrBigImg  = qrBig  ? `<img src="${qrBig}"  alt="QR tracking bagage" />` : '';
  const qrMiniImg = qrMini ? `<img src="${qrMini}" alt="QR mini" />` : '';

  const routeOrigin = escHtml(trip.origin.slice(0, 3).toUpperCase());
  const routeDest   = escHtml(trip.destination.slice(0, 3).toUpperCase());

  const body = `
${impBanner(scope)}

<div class="bag-tag">

  <!-- ═══ HEADER TRANSPORTEUR ═══ -->
  <div class="bag-header">
    <div class="tenant-name">${escHtml(tenantName)}</div>
    <div class="ref">Talon Bagage · Checked Baggage</div>
  </div>

  <!-- ═══ QR PRINCIPAL ═══ -->
  <div class="bag-qr-zone">
    ${qrBigImg}
    <div class="bag-tracking">${escHtml(tag.trackingCode)}</div>
  </div>

  <!-- ═══ TRAJET ═══ -->
  <div class="bag-route">
    <div>
      <div class="city-label">Départ</div>
      <div class="city">${routeOrigin}</div>
      <div style="font-size:7.5pt;opacity:.8;margin-top:0.5mm;">${escHtml(trip.origin)}</div>
    </div>
    <div class="arrow">→</div>
    <div style="text-align:right;">
      <div class="city-label">Destination</div>
      <div class="city">${routeDest}</div>
      <div style="font-size:7.5pt;opacity:.8;margin-top:0.5mm;">${escHtml(trip.destination)}</div>
    </div>
  </div>

  <!-- ═══ PASSAGER ═══ -->
  <div class="bag-section">
    <div class="bag-label">Passager</div>
    <div class="bag-value">${escHtml(passenger.name)}</div>
    ${passenger.phone ? `<div class="bag-value-sm">${escHtml(passenger.phone)}</div>` : ''}
    ${passenger.ticketId ? `<div class="bag-value-sm mono" style="font-size:7pt;">Billet : ${escHtml(passenger.ticketId)}</div>` : ''}
  </div>

  <!-- ═══ DATE & BUS ═══ -->
  <div class="bag-section">
    <div class="bag-label">Date de départ</div>
    <div class="bag-value">${fmtDate(trip.departureScheduled)}</div>
    ${trip.routeName ? `<div class="bag-value-sm">${escHtml(trip.routeName)}</div>` : ''}
    ${trip.busPlate  ? `<div class="bag-value-sm">Bus : ${escHtml(trip.busPlate)}</div>` : ''}
  </div>

  <!-- ═══ POIDS & N° ═══ -->
  <div class="bag-weight-row">
    <div>
      <div class="bag-label">Poids</div>
      <div class="bag-weight-badge">${tag.weight} kg</div>
    </div>
    <div style="text-align:right;">
      <div class="bag-label">Bagage</div>
      <div class="bag-num">${tag.bagNumber} <span class="total">/ ${tag.totalBags}</span></div>
    </div>
  </div>

  ${tag.description ? `
  <div class="bag-section">
    <div class="bag-label">Description</div>
    <div class="bag-value-sm">${escHtml(tag.description)}</div>
  </div>` : ''}

  <!-- ═══ PERFORATION + COUPON ═══ -->
  ${perfLine('Coupon passager — à conserver')}

  <div class="bag-stub">
    <div class="stub-info">
      <div class="stub-label">Transporteur</div>
      <div style="font-size:8.5pt;font-weight:700;">${escHtml(tenantName)}</div>
      <div class="stub-label" style="margin-top:2mm;">Référence tracking</div>
      <div class="stub-code">${escHtml(tag.trackingCode)}</div>
      <div class="stub-label" style="margin-top:2mm;">Trajet</div>
      <div style="font-size:8pt;">${escHtml(trip.origin)} → ${escHtml(trip.destination)}</div>
      <div style="font-size:7.5pt;color:var(--c-muted);">${fmtDate(trip.departureScheduled)}</div>
    </div>
    ${qrMiniImg}
  </div>

</div>
`;

  const raw = htmlProDoc(`Talon bagage — ${tag.trackingCode}`, body, 'BAGGAGE_TAG', CSS);
  return certifyPro(raw, actorId, scope);
}
