/**
 * EnvelopeRenderer — Enveloppe C5 / DL avec fenêtre destinataire
 *
 * Deux formats :
 *   - C5  (229×162mm, landscape) : enveloppe standard A5 plié
 *   - DL  (220×110mm, landscape) : enveloppe allongée A4 plié en 3
 *
 * Zones :
 *   ┌────────────────────────────────────────────────────┐
 *   │ EXPÉDITEUR (haut-gauche)  │        │ AFFRANCHISSEMENT (haut-droite) │
 *   │                                                                    │
 *   │         ┌──────────────────────────┐                               │
 *   │         │  FENÊTRE DESTINATAIRE    │                               │
 *   │         │  (zone transparente)     │                               │
 *   │         └──────────────────────────┘                               │
 *   │                                                                    │
 *   │           CODE-BARRES POSTAL (optionnel)                           │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Usage Puppeteer : format='ENVELOPE_C5' ou 'ENVELOPE_DL', landscape=false
 * (le @page landscape est déjà inclus dans le preset CSS)
 */
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';
import {
  htmlProDoc, certifyPro, impBanner, escHtml, fmtDate, qrPng,
} from './shared-pro';

export interface EnvelopeData {
  recipient: {
    name:    string;
    address: string;
    city:    string;
    zip?:    string;
    country?: string;
  };
  sender: {
    name:    string;
    address: string;
    city?:   string;
    zip?:    string;
  };
  reference?:  string;          // N° de traçage affiché sous la fenêtre
  format?:     'C5' | 'DL';    // Défaut C5
  barcode?:    string;          // Code postal QR (URL ou référence)
  tenantName:  string;
  actorId:     string;
  scope?:      ScopeContext;
}

// ─── CSS enveloppe ──────────────────────────────────────────────────────────

const CSS_C5 = `
  body {
    padding: 0; margin: 0;
    width: 229mm; height: 162mm;
    position: relative; overflow: hidden;
  }
  /* Guide de pliage (non imprimé — aide à la mise en enveloppe) */
  .fold-guide {
    position: absolute; top: 0; bottom: 0;
    left: 50%; width: 0.3pt; background: #e2e8f0;
  }

  /* Zone expéditeur — haut gauche */
  .env-sender {
    position: absolute; top: 8mm; left: 8mm;
    font-size: 7.5pt; line-height: 1.6; color: var(--c-muted);
    max-width: 65mm;
  }
  .env-sender .sname { font-size: 8pt; font-weight: 700; color: var(--c-brand); }

  /* Zone affranchissement — haut droite */
  .env-stamp {
    position: absolute; top: 8mm; right: 8mm;
    width: 35mm; height: 28mm;
    border: 1pt dashed #94a3b8;
    border-radius: 2pt;
    display: flex; align-items: center; justify-content: center;
    flex-direction: column; gap: 1mm;
    color: #94a3b8; font-size: 7pt; text-align: center;
  }
  .env-stamp .stamp-icon { font-size: 18pt; }

  /* Fenêtre destinataire — centre-gauche */
  .env-window {
    position: absolute; left: 24mm; top: 60mm;
    width: 90mm; height: 40mm;
    border: 1.5pt solid var(--c-brand);
    border-radius: 2pt;
    padding: 4mm 5mm;
    background: #f8fafc;
  }
  .env-window .to-label {
    font-size: 6pt; text-transform: uppercase; letter-spacing: .1em;
    color: var(--c-muted); font-weight: 700; margin-bottom: 2mm;
  }
  .env-window .to-name {
    font-size: 11pt; font-weight: 700; color: var(--c-brand); margin-bottom: 1mm;
  }
  .env-window .to-addr { font-size: 8.5pt; line-height: 1.7; }

  /* Référence sous la fenêtre */
  .env-ref {
    position: absolute; left: 24mm; top: 104mm;
    font-size: 6.5pt; color: var(--c-muted); font-family: var(--font-mono);
  }

  /* QR code postal — bas droite */
  .env-qr {
    position: absolute; right: 10mm; bottom: 8mm;
    text-align: center;
  }
  .env-qr img { width: 20mm; height: 20mm; }
  .env-qr .qr-ref { font-size: 5.5pt; font-family: var(--font-mono); color: var(--c-muted); margin-top: 0.5mm; }

  /* Date imprimée */
  .env-date {
    position: absolute; right: 10mm; top: 42mm;
    font-size: 6pt; color: var(--c-muted);
  }
`;

const CSS_DL = `
  body {
    padding: 0; margin: 0;
    width: 220mm; height: 110mm;
    position: relative; overflow: hidden;
  }
  .env-sender {
    position: absolute; top: 6mm; left: 6mm;
    font-size: 7pt; line-height: 1.6; color: var(--c-muted); max-width: 55mm;
  }
  .env-sender .sname { font-size: 7.5pt; font-weight: 700; color: var(--c-brand); }
  .env-stamp {
    position: absolute; top: 6mm; right: 6mm;
    width: 28mm; height: 22mm;
    border: 1pt dashed #94a3b8; border-radius: 2pt;
    display: flex; align-items: center; justify-content: center;
    flex-direction: column; color: #94a3b8; font-size: 6pt; text-align: center;
  }
  .env-stamp .stamp-icon { font-size: 14pt; }
  .env-window {
    position: absolute; left: 20mm; top: 42mm;
    width: 80mm; height: 34mm;
    border: 1.5pt solid var(--c-brand); border-radius: 2pt;
    padding: 3mm 4mm; background: #f8fafc;
  }
  .env-window .to-label { font-size: 6pt; text-transform: uppercase; letter-spacing: .1em; color: var(--c-muted); font-weight: 700; margin-bottom: 1.5mm; }
  .env-window .to-name  { font-size: 10pt; font-weight: 700; color: var(--c-brand); margin-bottom: 0.5mm; }
  .env-window .to-addr  { font-size: 8pt; line-height: 1.6; }
  .env-ref  { position: absolute; left: 20mm; top: 80mm; font-size: 6pt; color: var(--c-muted); font-family: var(--font-mono); }
  .env-qr   { position: absolute; right: 8mm; bottom: 6mm; text-align: center; }
  .env-qr img { width: 18mm; height: 18mm; }
  .env-qr .qr-ref { font-size: 5pt; font-family: var(--font-mono); color: var(--c-muted); }
  .env-date { position: absolute; right: 8mm; top: 32mm; font-size: 6pt; color: var(--c-muted); }
  .fold-guide { position: absolute; top: 0; bottom: 0; left: 33%; width: 0.3pt; background: #e2e8f0; }
  .fold-guide-2 { position: absolute; top: 0; bottom: 0; left: 66%; width: 0.3pt; background: #e2e8f0; }
`;

export async function renderEnvelope(data: EnvelopeData): Promise<string> {
  const { recipient, sender, reference, format = 'C5', barcode, tenantName, actorId, scope } = data;

  const qrSrc = barcode ? await qrPng(barcode, 80) : null;
  const qrImg = qrSrc ? `<img src="${qrSrc}" alt="Code postal" /><div class="qr-ref">${escHtml(barcode ?? '')}</div>` : '';

  const fmtKey = format === 'C5' ? 'ENVELOPE_C5' : 'ENVELOPE_DL';
  const css    = format === 'C5' ? CSS_C5 : CSS_DL;

  const foldGuides = format === 'DL'
    ? `<div class="fold-guide no-print"></div><div class="fold-guide-2 no-print"></div>`
    : `<div class="fold-guide no-print"></div>`;

  const body = `
${impBanner(scope)}
${foldGuides}

<!-- ═══ EXPÉDITEUR ═══ -->
<div class="env-sender">
  <div class="sname">${escHtml(sender.name)}</div>
  ${escHtml(sender.address)}<br>
  ${sender.zip ? escHtml(sender.zip) + ' ' : ''}${escHtml(sender.city ?? '')}
</div>

<!-- ═══ ZONE AFFRANCHISSEMENT ═══ -->
<div class="env-stamp">
  <div class="stamp-icon">✉</div>
  Affranchissement
</div>

<!-- ═══ DATE ═══ -->
<div class="env-date">${fmtDate(new Date())}</div>

<!-- ═══ FENÊTRE DESTINATAIRE ═══ -->
<div class="env-window">
  <div class="to-label">Destinataire</div>
  <div class="to-name">${escHtml(recipient.name)}</div>
  <div class="to-addr">
    ${escHtml(recipient.address)}<br>
    ${recipient.zip ? escHtml(recipient.zip) + ' ' : ''}${escHtml(recipient.city)}<br>
    ${recipient.country ? escHtml(recipient.country) : ''}
  </div>
</div>

<!-- ═══ RÉFÉRENCE ═══ -->
${reference ? `<div class="env-ref">Réf : ${escHtml(reference)}</div>` : ''}

<!-- ═══ QR POSTAL ═══ -->
${qrImg ? `<div class="env-qr">${qrImg}</div>` : ''}
`;

  const raw = htmlProDoc(
    `Enveloppe ${format} — ${tenantName}`,
    body,
    fmtKey as any,
    css,
  );
  return certifyPro(raw, actorId, scope);
}
