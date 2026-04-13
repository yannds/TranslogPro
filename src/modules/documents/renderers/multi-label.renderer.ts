/**
 * MultiLabelRenderer — Feuille multi-impression d'étiquettes colis (A4)
 *
 * Disposition 2×4 sur A4 (8 étiquettes par page) ou 2×2 (4 par page, plus grandes)
 * Adapté à l'impression sur planche d'étiquettes adhésives standard (Avery L7160).
 *
 * Chaque étiquette contient :
 *   - Code de suivi (QR + texte)
 *   - Expéditeur / Destinataire
 *   - Destination / Poids
 *   - Statut (badge coloré)
 *
 * Format @page : A4 portrait, margin 10mm (zone de sécurité planche)
 * Layout CSS Grid : 2 colonnes × n lignes, gap = trait de coupe
 *
 * Usage Puppeteer : format='A4', landscape=false
 */
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';
import {
  htmlProDoc, certifyPro, impBanner, escHtml, fmtDate, fmtCfa, qrPng,
} from './shared-pro';

export interface LabelItem {
  trackingCode:  string;
  weight:        number;
  price:         number;
  status:        string;
  createdAt:     Date;
  recipientInfo: { name?: string; phone?: string; address?: string };
  sender:        { name?: string | null; email?: string } | null;
  destination?:  { name: string; city?: string } | null;
}

export interface MultiLabelData {
  items:      LabelItem[];
  tenantName: string;
  layout?:    '2x4' | '2x2';   // Défaut 2x4 (8 étiquettes/page)
  actorId:    string;
  scope?:     ScopeContext;
}

const CSS = `
  body { padding: 0; }

  /* ── Grille d'étiquettes ───────────────────────────────────── */
  .label-grid {
    display: grid;
    gap: 0;          /* Le gap est simulé par la bordure des cellules */
    width: 100%;
  }
  .label-grid.layout-2x4 { grid-template-columns: 1fr 1fr; }
  .label-grid.layout-2x2 { grid-template-columns: 1fr 1fr; }

  /* ── Étiquette individuelle ─────────────────────────────────── */
  .label-cell {
    border: 0.5pt solid #94a3b8;
    padding: 3mm;
    break-inside: avoid;
    overflow: hidden;
    position: relative;
    /* Tirets de coupe sur les bords */
    outline: 0.3pt dashed #cbd5e1;
    outline-offset: -1.5mm;
  }
  .layout-2x4 .label-cell { height: 36mm; }
  .layout-2x2 .label-cell { height: 65mm; }

  /* Header étiquette */
  .lbl-header {
    display: flex; justify-content: space-between; align-items: center;
    border-bottom: 1pt solid var(--c-brand); padding-bottom: 1.5mm; margin-bottom: 2mm;
  }
  .lbl-company { font-size: 6pt; font-weight: 700; color: var(--c-muted); text-transform: uppercase; letter-spacing: .08em; }
  .lbl-date    { font-size: 5.5pt; color: var(--c-muted); }

  /* Corps : QR gauche + infos droite */
  .lbl-body {
    display: grid; gap: 2mm; align-items: start;
    flex: 1;
  }
  .layout-2x4 .lbl-body { grid-template-columns: 20mm 1fr; }
  .layout-2x2 .lbl-body { grid-template-columns: 30mm 1fr; }

  /* QR */
  .lbl-qr img  { display: block; }
  .lbl-qr .tc  { font-size: 5pt; font-family: var(--font-mono); text-align: center; margin-top: 0.5mm; word-break: break-all; }
  .layout-2x4 .lbl-qr img { width: 20mm; height: 20mm; }
  .layout-2x2 .lbl-qr img { width: 30mm; height: 30mm; }

  /* Infos */
  .lbl-info    { font-size: 7pt; }
  .lbl-section { margin-bottom: 1.5mm; }
  .lbl-section .s-title { font-size: 5.5pt; text-transform: uppercase; letter-spacing: .08em; color: var(--c-muted); font-weight: 700; margin-bottom: 0.5mm; }
  .lbl-section .s-name  { font-size: 8pt; font-weight: 700; }
  .lbl-section .s-sub   { font-size: 6pt; color: var(--c-muted); }

  /* Pied étiquette */
  .lbl-footer {
    border-top: 0.5pt solid var(--c-line); padding-top: 1mm; margin-top: 1mm;
    display: flex; justify-content: space-between; align-items: center; font-size: 6pt;
  }
  .lbl-footer .weight { font-weight: 700; color: var(--c-brand2); }
  .lbl-footer .dest   { color: var(--c-muted); }
  .status-dot {
    width: 5mm; height: 5mm; border-radius: 50%;
    position: absolute; top: 3mm; right: 3mm;
  }
  .status-ok   { background: #16a34a; }
  .status-warn { background: #d97706; }
  .status-err  { background: #dc2626; }

  /* Étiquette vide (slot non utilisé) */
  .label-empty { background: #f8fafc; }
`;

function statusDotClass(status: string): string {
  const ok   = ['DELIVERED', 'ARRIVED', 'VERIFIED', 'CONFIRMED'];
  const warn = ['PENDING', 'IN_TRANSIT', 'LOADED', 'PACKED'];
  if (ok.includes(status))   return 'status-ok';
  if (warn.includes(status)) return 'status-warn';
  return 'status-err';
}

export async function renderMultiLabel(data: MultiLabelData): Promise<string> {
  const { items, tenantName, layout = '2x4', actorId, scope } = data;

  // Génère tous les QR en parallèle
  const qrSrcs = await Promise.all(
    items.map(item => qrPng(item.trackingCode, layout === '2x4' ? 80 : 120)),
  );

  // Calcul nombre de slots (arrondi au multiple de 2)
  const slotsPerPage = layout === '2x4' ? 8 : 4;
  const totalSlots   = Math.ceil(items.length / slotsPerPage) * slotsPerPage;
  const slots        = [...items, ...Array(totalSlots - items.length).fill(null)];

  const cells = slots.map((item, i) => {
    if (!item) {
      return `<div class="label-cell label-empty"></div>`;
    }
    const lbl  = item as LabelItem;
    const qr   = qrSrcs[i];
    const r    = lbl.recipientInfo;
    const dest = lbl.destination;

    return `
      <div class="label-cell">
        <div class="status-dot ${statusDotClass(lbl.status)}"></div>

        <div class="lbl-header">
          <div class="lbl-company">${escHtml(tenantName)}</div>
          <div class="lbl-date">${fmtDate(lbl.createdAt)}</div>
        </div>

        <div class="lbl-body">
          <div class="lbl-qr">
            ${qr ? `<img src="${qr}" alt="QR ${escHtml(lbl.trackingCode)}" />` : ''}
            <div class="tc">${escHtml(lbl.trackingCode)}</div>
          </div>

          <div class="lbl-info">
            <div class="lbl-section">
              <div class="s-title">Expéditeur</div>
              <div class="s-name">${escHtml(lbl.sender?.name ?? lbl.sender?.email ?? '—')}</div>
            </div>
            <div class="lbl-section">
              <div class="s-title">Destinataire</div>
              <div class="s-name">${escHtml(r?.name ?? '—')}</div>
              <div class="s-sub">
                ${escHtml(String(r?.address ?? ''))}<br>
                ${r?.phone ? escHtml(r.phone) : ''}
              </div>
            </div>
          </div>
        </div>

        <div class="lbl-footer">
          <span class="weight">${lbl.weight} kg</span>
          <span class="dest">${escHtml(dest?.name ?? '—')}${dest?.city ? ` (${escHtml(dest.city)})` : ''}</span>
          <span style="color:var(--c-muted);">${fmtCfa(lbl.price)}</span>
        </div>
      </div>`;
  }).join('');

  const body = `
${impBanner(scope)}

<!-- ═══ FEUILLE D'ÉTIQUETTES ${layout.toUpperCase()} ═══ -->
<div class="label-grid layout-${layout}">
  ${cells}
</div>
`;

  const raw = htmlProDoc(
    `Étiquettes (${items.length}) — ${tenantName}`,
    body,
    'A4',
    CSS,
  );
  return certifyPro(raw, actorId, scope);
}
