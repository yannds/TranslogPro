/**
 * shared-pro.ts — Base CSS & utilitaires pour renderers haute-fidélité
 *
 * Objectif "Carbone.io parity" :
 *   • CSS @page avec dimensions exactes au mm
 *   • print-color-adjust: exact → couleurs de fond imprimées telles quelles
 *   • Perforations CSS (dashed + ciseau)
 *   • Grille multi-impression (4-up, 6-up…)
 *   • Typographie professionnelle (Helvetica Neue stack)
 *   • Variables CSS pour theming par tenant futur
 *
 * Architecture :
 *   Chaque renderer importe htmlProDoc() + les helpers utilitaires.
 *   Il injecte son propre CSS @page (format papier) via le paramètre pageCss.
 *   Le certify() de shared.ts reste la source de vérité pour le fingerprint.
 */
import { createHash }   from 'crypto';
import * as QRCode      from 'qrcode';
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';
import { escHtml, fmtDate, fmtCfa } from './shared';

export { escHtml, fmtDate, fmtCfa };

// ─── CSS commun haute-fidélité ───────────────────────────────────────────────

/** CSS de base (reset + variables + typographie) */
export const PRO_BASE_CSS = `
  :root {
    --c-brand:    #0f172a;   /* Slate-900 — fond sombre */
    --c-brand2:   #1e3a5f;   /* Bleu marine accent */
    --c-accent:   #f59e0b;   /* Ambre — accent chaud UEMOA */
    --c-muted:    #64748b;   /* Texte secondaire */
    --c-line:     #e2e8f0;   /* Séparateur léger */
    --c-ok:       #16a34a;
    --c-warn:     #d97706;
    --c-danger:   #dc2626;
    --font-sans:  'Helvetica Neue', Arial, 'Nimbus Sans L', sans-serif;
    --font-mono:  'Courier New', Courier, monospace;
  }
  *, *::before, *::after {
    box-sizing: border-box; margin: 0; padding: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  html, body {
    font-family: var(--font-sans);
    font-size: 10pt;
    color: var(--c-brand);
    background: #fff;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }
  /* Empêche les coupures intempestives */
  table { border-collapse: collapse; width: 100%; }
  thead { display: table-header-group; }
  tr    { break-inside: avoid; page-break-inside: avoid; }
  img   { display: block; }

  /* Utilitaires position */
  .flex  { display: flex; }
  .grid  { display: grid; }
  .col   { flex-direction: column; }
  .sb    { justify-content: space-between; }
  .ac    { align-items: center; }
  .gap4  { gap: 4mm; }
  .gap6  { gap: 6mm; }
  .gap8  { gap: 8mm; }
  .w100  { width: 100%; }
  .ta-r  { text-align: right; }
  .ta-c  { text-align: center; }
  .bold  { font-weight: 700; }
  .mono  { font-family: var(--font-mono); }
  .muted { color: var(--c-muted); font-size: 8pt; }
  .upper { text-transform: uppercase; letter-spacing: .06em; }
  .nowrap{ white-space: nowrap; }

  /* Badge statut */
  .badge {
    display: inline-block; padding: 1pt 5pt; border-radius: 2pt;
    font-size: 7pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: .04em;
  }
  .badge-ok   { background: #dcfce7; color: #166534; }
  .badge-warn { background: #fef9c3; color: #854d0e; }
  .badge-err  { background: #fee2e2; color: #991b1b; }

  /* Impersonation banner */
  .imp-banner {
    background: #fef3c7; border: 1.5pt solid #f59e0b;
    padding: 4pt 8pt; margin-bottom: 6mm;
    font-size: 8pt; font-weight: 700; color: #92400e;
    border-radius: 2pt;
  }

  /* Perforation */
  .perf {
    position: relative; margin: 4mm 0;
    border-top: 1.5pt dashed #94a3b8;
  }
  .perf::before {
    content: '✂';
    position: absolute; left: -5mm; top: -6pt;
    font-size: 10pt; color: #94a3b8; line-height: 1;
  }
  .perf-label {
    position: absolute; left: 0; right: 0; top: -7pt;
    text-align: center; font-size: 7pt; color: #94a3b8;
    background: #fff; display: inline-block; width: 60mm; margin: 0 auto;
    line-height: 1;
  }

  /* Fingerprint */
  .fp {
    margin-top: 6mm; padding-top: 3mm;
    border-top: 0.5pt dashed #cbd5e1;
    font-size: 6pt; color: #94a3b8; word-break: break-all;
    font-family: var(--font-mono);
  }
  @media print { .no-print { display: none !important; } }
`;

/** CSS bloc signature (page entière) */
export const SIG_BLOCK = `
  .sig-row {
    display: grid; grid-template-columns: 1fr 1fr; gap: 20mm;
    margin-top: 10mm;
  }
  .sig-line {
    border-top: 0.5pt solid var(--c-brand); padding-top: 2mm;
    font-size: 7.5pt; color: var(--c-muted);
  }
`;

// ─── Presets @page par format ─────────────────────────────────────────────────

export type ProFormat =
  | 'A4'
  | 'A5'
  | 'THERMAL_80MM'
  | 'LABEL_62MM'
  | 'ENVELOPE_C5'
  | 'ENVELOPE_DL'
  | 'BAGGAGE_TAG';

const PAGE_PRESET: Record<ProFormat, string> = {
  A4: `@page { size: 210mm 297mm; margin: 12mm 14mm; }`,
  A5: `@page { size: 148mm 210mm; margin: 10mm 12mm; }`,
  THERMAL_80MM: `@page { size: 80mm auto; margin: 3mm; }`,
  LABEL_62MM:   `@page { size: 62mm 100mm; margin: 2mm; }`,
  ENVELOPE_C5:  `@page { size: 229mm 162mm landscape; margin: 0; }`,
  ENVELOPE_DL:  `@page { size: 220mm 110mm landscape; margin: 0; }`,
  BAGGAGE_TAG:  `@page { size: 99mm 210mm; margin: 4mm; }`,
};

// ─── Utilitaires HTML ─────────────────────────────────────────────────────────

/** Wraps body in full HTML document with pro CSS + format preset */
export function htmlProDoc(
  title:    string,
  body:     string,
  format:   ProFormat = 'A4',
  extraCss  = '',
): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escHtml(title)}</title>
  <style>
    ${PAGE_PRESET[format]}
    ${PRO_BASE_CSS}
    ${SIG_BLOCK}
    ${extraCss}
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Génère une data-URL PNG du QR code (returns '' on error) */
export async function qrPng(value: string, size = 120): Promise<string> {
  try {
    return await QRCode.toDataURL(value, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width:  size,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
  } catch { return ''; }
}

/** Fingerprint SHA-256 certifié */
export function certifyPro(html: string, actorId: string, scope?: ScopeContext): string {
  const ts          = Date.now();
  const impersonated = scope?.isImpersonating ? ':impersonated' : '';
  const fp          = createHash('sha256').update(html).digest('hex');
  const comment     = `<!-- fp:${fp}:${ts}:${actorId}${impersonated} -->`;
  const div         = `<div class="fp">SHA-256 ${fp} · ${new Date(ts).toISOString()} · acteur ${actorId}${impersonated ? ' · IMPERSONATION' : ''}</div>`;
  return html.replace('</body>', `${div}\n${comment}\n</body>`);
}

/** Bannière impersonation */
export function impBanner(scope?: ScopeContext): string {
  if (!scope?.isImpersonating) return '';
  return `<div class="imp-banner">⚠ Document généré par support (impersonation) — agent : ${escHtml(scope.actorTenantId)}</div>`;
}

/** Ligne de perforation avec label optionnel */
export function perfLine(label = 'Détacher ici'): string {
  return `<div class="perf"><span class="perf-label no-print">${escHtml(label)}</span></div>`;
}

/** Tableau de données stylisé */
export function proTable(
  headers: string[],
  rows:    (string | number)[][],
  alignRight: number[] = [],   // indices de colonnes à aligner à droite
): string {
  const th = headers.map((h, i) =>
    `<th style="text-align:${alignRight.includes(i) ? 'right' : 'left'}">${escHtml(h)}</th>`
  ).join('');
  const tr = rows.map(r =>
    `<tr>${r.map((v, i) => `<td style="text-align:${alignRight.includes(i) ? 'right' : 'left'}">${v}</td>`).join('')}</tr>`
  ).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}
