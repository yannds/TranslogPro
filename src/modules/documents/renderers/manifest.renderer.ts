/**
 * ManifestRenderer — manifeste de bord conducteur
 *
 * Contenu :
 *   - En-tête : trajet, véhicule, conducteur, date
 *   - Liste des passagers (nom, siège, statut, destination de descente)
 *   - Liste des colis par shipment (code de suivi, poids, destination)
 *   - Totaux et indicateurs opérationnels
 *   - Fingerprint SHA-256 du document
 *
 * Cohérence temps réel : le manifeste est régénéré à chaque appel.
 * Si un passager est ajouté ou un colis chargé après la première génération,
 * le manifeste suivant reflète l'état courant de la DB.
 */
import { htmlDoc, certify, escHtml, fmtDate, fmtCfa, impersonationBanner } from './shared';
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';

export interface ManifestTraveler {
  id:                 string;
  passengerName:      string;
  seatNumber:         string | null;
  status:             string;
  dropOffStationId:   string | null;
}

export interface ManifestParcel {
  id:           string;
  trackingCode: string;
  weight:       number;
  status:       string;
  destinationId: string;
}

export interface ManifestRenderData {
  trip: {
    id:                 string;
    status:             string;
    departureScheduled: Date;
    arrivalScheduled:   Date;
    route:              { name: string } | null;
    bus:                { plateNumber: string; model: string; capacity: number } | null;
    driver:             { name: string | null; email: string } | null;
  };
  travelers:  ManifestTraveler[];
  shipments:  { id: string; destinationId: string; totalWeight: number; status: string; parcels: ManifestParcel[] }[];
  tenantName: string;
  actorId:    string;
  scope:      ScopeContext | undefined;
}

export function renderManifest(data: ManifestRenderData): string {
  const { trip, travelers, shipments, tenantName, actorId, scope } = data;
  const totalParcels = shipments.reduce((s, sh) => s + sh.parcels.length, 0);
  const totalWeight  = shipments.reduce((s, sh) => s + sh.totalWeight, 0);

  const travelerRows = travelers.length === 0
    ? `<tr><td colspan="4" style="text-align:center;color:#888;">Aucun passager embarqué</td></tr>`
    : travelers.map(t => `
        <tr>
          <td>${escHtml(t.passengerName)}</td>
          <td>${escHtml(t.seatNumber ?? '—')}</td>
          <td><span class="badge ${badgeClass(t.status)}">${escHtml(t.status)}</span></td>
          <td>${escHtml(t.dropOffStationId ?? '—')}</td>
        </tr>`).join('');

  const shipmentSections = shipments.map(sh => {
    const parcelRows = sh.parcels.length === 0
      ? `<tr><td colspan="4" style="text-align:center;color:#888;">Aucun colis</td></tr>`
      : sh.parcels.map(p => `
          <tr>
            <td><code>${escHtml(p.trackingCode)}</code></td>
            <td>${p.weight} kg</td>
            <td><span class="badge ${badgeClass(p.status)}">${escHtml(p.status)}</span></td>
            <td>${escHtml(p.destinationId)}</td>
          </tr>`).join('');

    return `
      <div class="section">
        <h2>Shipment — Destination : ${escHtml(sh.destinationId)} (${sh.parcels.length} colis, ${sh.totalWeight} kg)</h2>
        <table>
          <thead><tr><th>Code suivi</th><th>Poids</th><th>Statut</th><th>Destination</th></tr></thead>
          <tbody>${parcelRows}</tbody>
        </table>
      </div>`;
  }).join('');

  const body = `
${impersonationBanner(scope)}
<div class="doc-header">
  <div>
    <h1>MANIFESTE DE BORD</h1>
    <div style="font-size:10px;color:#555;margin-top:4px;">${escHtml(tenantName)} — Généré le ${fmtDate(new Date())}</div>
  </div>
  <div class="meta">
    Trip : ${escHtml(trip.id.slice(0, 12).toUpperCase())}<br>
    Statut : <strong>${escHtml(trip.status)}</strong><br>
    Ligne : ${escHtml(trip.route?.name ?? '—')}
  </div>
</div>

<div class="two-col">
  <div class="section">
    <h2>Informations trajet</h2>
    <div class="field"><label>Départ prévu</label><span>${fmtDate(trip.departureScheduled)}</span></div>
    <div class="field"><label>Arrivée prévue</label><span>${fmtDate(trip.arrivalScheduled)}</span></div>
    <div class="field"><label>Conducteur</label><span>${escHtml(trip.driver?.name ?? trip.driver?.email ?? '—')}</span></div>
  </div>
  <div class="section">
    <h2>Véhicule & Capacité</h2>
    <div class="field"><label>Immatriculation</label><span>${escHtml(trip.bus?.plateNumber ?? '—')}</span></div>
    <div class="field"><label>Modèle</label><span>${escHtml(trip.bus?.model ?? '—')}</span></div>
    <div class="field"><label>Capacité</label><span>${trip.bus?.capacity ?? '—'} places</span></div>
    <div class="field"><label>Passagers à bord</label><span><strong>${travelers.length}</strong> / ${trip.bus?.capacity ?? '?'}</span></div>
    <div class="field"><label>Colis</label><span><strong>${totalParcels}</strong> (${totalWeight} kg)</span></div>
  </div>
</div>

<div class="section">
  <h2>Passagers (${travelers.length})</h2>
  <table>
    <thead><tr><th>Nom</th><th>Siège</th><th>Statut</th><th>Descente</th></tr></thead>
    <tbody>${travelerRows}</tbody>
  </table>
</div>

${shipmentSections || '<div class="section"><h2>Colis</h2><p style="color:#888;">Aucun shipment pour ce trajet.</p></div>'}

<div class="section no-print" style="margin-top:8px;font-size:10px;color:#888;">
  Document officiel — Ne pas divulguer — Valide uniquement pour le trajet ${escHtml(trip.id.slice(0, 12).toUpperCase())}
</div>
`;

  const raw = htmlDoc(`Manifeste ${trip.id.slice(0, 12).toUpperCase()} — ${tenantName}`, body);
  return certify(raw, actorId, scope);
}

function badgeClass(status: string): string {
  const ok   = ['CONFIRMED', 'DELIVERED', 'BOARDED', 'VERIFIED', 'ARRIVED', 'ACTIVE'];
  const warn = ['PENDING', 'PENDING_PAYMENT', 'PACKED', 'LOADED', 'IN_TRANSIT', 'OPEN'];
  if (ok.includes(status))   return 'badge-ok';
  if (warn.includes(status)) return 'badge-warn';
  return 'badge-err';
}
