/**
 * ParcelLabelRenderer — étiquette de colis + bordereau d'expédition
 *
 * Deux formats dans le même HTML :
 *   1. Étiquette (format A6 simulé) : QR de tracking, expéditeur, destinataire, poids
 *   2. Bordereau d'expédition (packing list) : tous les colis d'un shipment
 *
 * Le QR code embarqué encode le trackingCode (public — non signé HMAC).
 * L'URL de tracking public sera du type : https://track.example.com/{trackingCode}
 */
import { htmlDoc, certify, qrDataUrl, escHtml, fmtDate, fmtCfa, impersonationBanner } from './shared';
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';

export interface ParcelLabelData {
  parcel: {
    id:            string;
    trackingCode:  string;
    weight:        number;
    price:         number;
    status:        string;
    createdAt:     Date;
    recipientInfo: Record<string, unknown>;
    sender:        { name: string | null; email: string } | null;
    destination:   { name: string; city: string } | null;
  };
  tenantName:   string;
  trackingBase: string;  // ex: "https://track.example.com"
  actorId:      string;
  scope:        ScopeContext | undefined;
}

export async function renderParcelLabel(data: ParcelLabelData): Promise<string> {
  const { parcel, tenantName, trackingBase, actorId, scope } = data;
  const trackingUrl = `${trackingBase}/${parcel.trackingCode}`;
  const qrSrc = await qrDataUrl(trackingUrl);
  const qrImg = qrSrc
    ? `<img src="${qrSrc}" alt="QR suivi colis" width="120" height="120" />`
    : `<code>${escHtml(parcel.trackingCode)}</code>`;

  const recipient = parcel.recipientInfo as { name?: string; phone?: string; address?: string };

  const body = `
${impersonationBanner(scope)}

<!-- ═══════════════════ ÉTIQUETTE COLIS (format A6) ═══════════════════ -->
<div style="border:2px solid #1a1a1a;padding:12px;max-width:420px;margin:0 auto 24px;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
    <div>
      <div style="font-size:9px;color:#555;font-weight:700;">${escHtml(tenantName)}</div>
      <div style="font-size:9px;color:#555;">${fmtDate(parcel.createdAt)}</div>
    </div>
    <div style="text-align:center;">
      ${qrImg}
      <div style="font-size:8px;margin-top:2px;font-family:monospace;">${escHtml(parcel.trackingCode)}</div>
    </div>
  </div>

  <div style="border-top:1px solid #ddd;padding-top:8px;margin-bottom:8px;">
    <div style="font-size:9px;color:#555;font-weight:700;margin-bottom:2px;">EXPÉDITEUR</div>
    <div style="font-size:11px;">${escHtml(parcel.sender?.name ?? parcel.sender?.email ?? '—')}</div>
  </div>

  <div style="background:#1a1a1a;color:#fff;padding:8px;border-radius:2px;">
    <div style="font-size:9px;font-weight:700;margin-bottom:2px;">DESTINATAIRE</div>
    <div style="font-size:13px;font-weight:700;">${escHtml(recipient.name ?? '—')}</div>
    <div style="font-size:10px;margin-top:2px;">${escHtml(String(recipient.address ?? '—'))}</div>
    <div style="font-size:10px;">${escHtml(String(recipient.phone ?? ''))}</div>
  </div>

  <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10px;">
    <div><strong>Gare dest.:</strong> ${escHtml(parcel.destination?.name ?? '—')} (${escHtml(parcel.destination?.city ?? '—')})</div>
    <div><strong>${parcel.weight} kg</strong></div>
    <div><strong>${fmtCfa(parcel.price)}</strong></div>
  </div>

  <div style="margin-top:8px;font-size:9px;text-align:center;color:#555;">
    Statut : <strong>${escHtml(parcel.status)}</strong> — ${escHtml(parcel.id)}
  </div>
</div>

<!-- ═══════════════════ FIN ÉTIQUETTE ═══════════════════ -->
`;

  const raw = htmlDoc(`Étiquette ${parcel.trackingCode} — ${tenantName}`, body);
  return certify(raw, actorId, scope);
}

// ─── Packing List (liste de colisage d'un shipment entier) ─────────────────────

export interface PackingListData {
  shipment: {
    id:            string;
    destinationId: string;
    totalWeight:   number;
    status:        string;
    createdAt:     Date;
    parcels: Array<{
      id:           string;
      trackingCode: string;
      weight:       number;
      price:        number;
      status:       string;
      recipientInfo: Record<string, unknown>;
      sender:        { name: string | null; email: string } | null;
    }>;
  };
  trip:       { id: string; departureScheduled: Date; route: { name: string } | null } | null;
  tenantName: string;
  actorId:    string;
  scope:      ScopeContext | undefined;
}

export function renderPackingList(data: PackingListData): string {
  const { shipment, trip, tenantName, actorId, scope } = data;

  const rows = shipment.parcels.map((p, i) => {
    const r = p.recipientInfo as { name?: string; phone?: string; address?: string };
    return `
      <tr>
        <td>${i + 1}</td>
        <td><code style="font-size:10px;">${escHtml(p.trackingCode)}</code></td>
        <td>${escHtml(p.sender?.name ?? p.sender?.email ?? '—')}</td>
        <td>${escHtml(r.name ?? '—')}<br><small>${escHtml(String(r.phone ?? ''))}</small></td>
        <td>${p.weight} kg</td>
        <td>${fmtCfa(p.price)}</td>
        <td><span class="badge badge-ok">${escHtml(p.status)}</span></td>
      </tr>`;
  }).join('');

  const body = `
${impersonationBanner(scope)}
<div class="doc-header">
  <div>
    <h1>BORDEREAU D'EXPÉDITION</h1>
    <div style="font-size:10px;color:#555;margin-top:4px;">${escHtml(tenantName)}</div>
  </div>
  <div class="meta">
    Shipment : ${escHtml(shipment.id.slice(0, 12).toUpperCase())}<br>
    Dest. : ${escHtml(shipment.destinationId)}<br>
    ${trip ? `Trajet : ${escHtml(trip.route?.name ?? trip.id.slice(0, 12).toUpperCase())}<br>Départ : ${fmtDate(trip.departureScheduled)}` : ''}
  </div>
</div>

<div class="two-col" style="margin-bottom:16px;">
  <div class="field"><label>Statut shipment</label><span>${escHtml(shipment.status)}</span></div>
  <div class="field"><label>Poids total</label><span>${shipment.totalWeight} kg</span></div>
  <div class="field"><label>Nombre de colis</label><span>${shipment.parcels.length}</span></div>
  <div class="field"><label>Généré le</label><span>${fmtDate(new Date())}</span></div>
</div>

<div class="section">
  <table>
    <thead>
      <tr>
        <th>#</th><th>Code suivi</th><th>Expéditeur</th><th>Destinataire</th>
        <th>Poids</th><th>Valeur</th><th>Statut</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="7" style="text-align:center;">Aucun colis</td></tr>'}</tbody>
    <tfoot>
      <tr style="font-weight:700;background:#f5f5f5;">
        <td colspan="4" style="text-align:right;">TOTAL</td>
        <td>${shipment.totalWeight} kg</td>
        <td>${fmtCfa(shipment.parcels.reduce((s, p) => s + p.price, 0))}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</div>

<div style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:40px;font-size:11px;">
  <div>
    <div style="border-top:1px solid #1a1a1a;padding-top:4px;margin-top:24px;">Signature Expéditeur</div>
  </div>
  <div>
    <div style="border-top:1px solid #1a1a1a;padding-top:4px;margin-top:24px;">Signature Réceptionnaire</div>
  </div>
</div>
`;

  const raw = htmlDoc(`Bordereau ${shipment.id.slice(0, 12).toUpperCase()} — ${tenantName}`, body);
  return certify(raw, actorId, scope);
}
