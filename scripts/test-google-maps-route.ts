/**
 * scripts/test-google-maps-route.ts
 *
 * Sanity-check end-to-end du fournisseur Google Maps sur une ligne du tenant.
 *
 * Utilise EXCLUSIVEMENT les classes de l'application :
 *   - PrismaService (via PrismaClient)
 *   - VaultService (lecture de `platform/google-maps:API_KEY`)
 *   - GoogleMapsProvider / HaversineProvider (identiques au runtime)
 *   - Formule de prix segment = celle de RouteService.generateSegmentPriceMatrix
 *     (prorata distance : round(segmentKm / totalKm * basePrice))
 *
 * Sortie : un tableau 4 colonnes distance/prix avant (DB) vs après (Google)
 * pour chaque segment consécutif de la ligne, + totaux.
 *
 * Usage :
 *   npx ts-node scripts/test-google-maps-route.ts            # cherche "brazza" + "pointe"
 *   npx ts-node scripts/test-google-maps-route.ts <routeId>  # route précise
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { VaultService } from '../src/infrastructure/secret/vault.service';
import { GoogleMapsProvider } from '../src/modules/routing/providers/google-maps.provider';
import { HaversineProvider } from '../src/modules/routing/providers/haversine.provider';
import type { RoutingProvider, RoutePoint } from '../src/modules/routing/routing.types';

const DEFAULT_NAME_PATTERNS = ['brazza', 'pointe'];

interface Stop {
  stationId:     string;
  name:          string;
  coords:        RoutePoint | null;
  distanceFromOriginKm: number;
  tollCost:      number;
  kind:          string;
}

interface SegmentRow {
  from:        string;
  to:          string;
  distDb:      number;    // km avant (DB)
  distGoogle:  number;    // km après (Google)
  priceBefore: number;    // XAF avant (prorata distance DB)
  priceAfter:  number;    // XAF après (prorata distance Google)
  tollXaf:     number;    // péage de l'arrêt d'arrivée (waypoint.tollCostXaf)
  provider:    string;
  durationMin: number | null;
}

async function resolveProvider(): Promise<{ provider: RoutingProvider; source: string }> {
  // Reproduit la logique de RoutingService.resolveProvider() en standalone.
  const prisma = new PrismaClient();
  try {
    const row = await prisma.platformConfig.findFirst({ where: { key: 'routing.provider' } });
    const providerName = (row?.value as string | undefined) ?? 'haversine';
    if (providerName !== 'google') {
      await prisma.$disconnect();
      return { provider: new HaversineProvider(), source: `platformConfig=${providerName}` };
    }
    await prisma.$disconnect();
  } catch {
    await prisma.$disconnect();
  }

  try {
    const vault = new VaultService();
    const key = await vault.getSecret('platform/google-maps', 'API_KEY');
    return { provider: new GoogleMapsProvider(key), source: 'vault:platform/google-maps' };
  } catch (err) {
    console.warn(`⚠️  Impossible de lire la clé Google dans Vault : ${(err as Error).message}`);
    return { provider: new HaversineProvider(), source: 'fallback-haversine' };
  }
}

async function resolveEnabledAndProvider(): Promise<{ enabled: boolean; provider: string }> {
  const prisma = new PrismaClient();
  try {
    const enabledRow  = await prisma.platformConfig.findFirst({ where: { key: 'routing.enabled' } });
    const providerRow = await prisma.platformConfig.findFirst({ where: { key: 'routing.provider' } });
    const enabled  = (enabledRow?.value as any) === true || (enabledRow?.value as any) === 'true';
    const provider = (providerRow?.value as string | undefined) ?? 'haversine';
    return { enabled, provider };
  } finally {
    await prisma.$disconnect();
  }
}

function fmtKm(v: number): string { return `${v.toFixed(1)} km`.padStart(10); }
function fmtMoney(v: number): string { return `${v.toLocaleString('fr-FR')} XAF`.padStart(14); }

async function main() {
  console.log('\n🚌 Test Google Maps via TransLog Pro — distances + prix segment par segment\n');

  const cfg = await resolveEnabledAndProvider();
  console.log(`🔧 routing.enabled  = ${cfg.enabled}`);
  console.log(`🔧 routing.provider = ${cfg.provider}`);

  const { provider, source } = await resolveProvider();
  console.log(`🔧 Provider actif   = ${provider.name} (source: ${source})\n`);

  const prisma = new PrismaClient();

  const explicitId = process.argv[2];
  const route = explicitId
    ? await prisma.route.findFirst({
        where:   { id: explicitId },
        include: {
          origin:      true,
          destination: true,
          waypoints:   { include: { station: true }, orderBy: { order: 'asc' } },
        },
      })
    : await prisma.route.findFirst({
        where: {
          AND: DEFAULT_NAME_PATTERNS.map(p => ({ name: { contains: p, mode: 'insensitive' as const } })),
        },
        include: {
          origin:      true,
          destination: true,
          waypoints:   { include: { station: true }, orderBy: { order: 'asc' } },
        },
      });

  if (!route) {
    console.error(`❌ Aucune route trouvée.`);
    await prisma.$disconnect(); process.exit(1);
  }

  console.log(`📍 Route: "${route.name}" (tenant=${route.tenantId})`);
  console.log(`   DB distanceKm = ${route.distanceKm} km`);
  console.log(`   basePrice     = ${route.basePrice.toLocaleString('fr-FR')} XAF`);
  console.log(`   waypoints     = ${route.waypoints.length}`);

  // ── Construction du plan d'arrêts ordonnés ────────────────────────────────
  const extractCoords = (s: { coordinates: unknown } | null): RoutePoint | null => {
    if (!s?.coordinates || typeof s.coordinates !== 'object') return null;
    const c = s.coordinates as Record<string, unknown>;
    const lat = typeof c.lat === 'number' ? c.lat : null;
    const lng = typeof c.lng === 'number' ? c.lng : null;
    return lat !== null && lng !== null ? { lat, lng } : null;
  };

  // Construire la liste complète ordonnée (origine + waypoints dans l'ordre + destination)
  const allStops: Stop[] = [
    {
      stationId:           route.originId,
      name:                route.origin?.name ?? 'Origine',
      coords:              extractCoords(route.origin as any),
      distanceFromOriginKm:0,
      tollCost:            0,
      kind:                'STATION',
    },
    ...route.waypoints.map(w => ({
      stationId:           (w.stationId ?? '') as string,
      name:                w.name ?? w.station?.name ?? `waypoint#${w.order}`,
      coords:              extractCoords(w.station as any),
      distanceFromOriginKm:w.distanceFromOriginKm ?? 0,
      tollCost:            w.tollCostXaf ?? 0,
      kind:                w.kind ?? 'STATION',
    })),
    {
      stationId:           route.destinationId,
      name:                route.destination?.name ?? 'Destination',
      coords:              extractCoords(route.destination as any),
      distanceFromOriginKm:route.distanceKm,
      tollCost:            0,
      kind:                'STATION',
    },
  ];

  // Détection incohérence données : distanceFromOriginKm non monotone croissant
  const monotonyBreaks: Array<{ idx: number; name: string; prev: number; cur: number }> = [];
  for (let i = 1; i < allStops.length; i++) {
    if (allStops[i].distanceFromOriginKm < allStops[i - 1].distanceFromOriginKm) {
      monotonyBreaks.push({
        idx: i, name: allStops[i].name,
        prev: allStops[i - 1].distanceFromOriginKm,
        cur:  allStops[i].distanceFromOriginKm,
      });
    }
  }

  console.log(`\n🛣️  Plan complet (${allStops.length} entrées, incluant péages/police) :`);
  allStops.forEach((s, i) => {
    const coord = s.coords ? `${s.coords.lat.toFixed(4)},${s.coords.lng.toFixed(4)}` : '—'.padStart(17);
    const warn = i > 0 && s.distanceFromOriginKm < allStops[i - 1].distanceFromOriginKm ? ' ⚠ RECUL' : '';
    console.log(`  ${String(i + 1).padStart(2)}. ${s.name.padEnd(32)} ${s.kind.padEnd(10)} @${String(s.distanceFromOriginKm).padStart(5)} km  ${coord}  toll=${s.tollCost}${warn}`);
  });

  if (monotonyBreaks.length > 0) {
    console.log(`\n⚠️  Incohérence données : ${monotonyBreaks.length} waypoint(s) avec distanceFromOriginKm en RECUL.`);
    console.log('    Les distances absolues depuis l\'origine ne sont pas monotones croissantes.');
    console.log('    À corriger dans l\'éditeur de ligne → onglet Waypoints.');
  }

  // ── Sélection des arrêts "calculables" ───────────────────────────────────
  // On ne garde pour la comparaison Google que les stations qui ont des coords GPS.
  // Les waypoints PEAGE/POLICE/CONTROLE sans GPS sont repositionnés en "markers"
  // dont le péage s'additionne au segment station-à-station qui les englobe.
  const stops = allStops.filter(s => s.kind === 'STATION' && s.coords !== null);

  // Agrège les péages des markers (non-station) entre deux stations pour les affecter
  // au segment correspondant.
  const segmentTollByIndex = new Map<number, number>();
  for (let k = 0; k < allStops.length; k++) {
    const s = allStops[k];
    if (s.kind === 'STATION' || !s.tollCost) continue;
    // Trouve l'index du segment qui contient ce marker : dernière STATION précédente avec GPS.
    let before = -1;
    for (let j = k - 1; j >= 0; j--) {
      if (allStops[j].kind === 'STATION' && allStops[j].coords) { before = j; break; }
    }
    if (before < 0) continue;
    // Index du segment = position de cette station dans `stops`.
    const segIdx = stops.findIndex(st => st === allStops[before]);
    if (segIdx < 0 || segIdx >= stops.length - 1) continue;
    segmentTollByIndex.set(segIdx, (segmentTollByIndex.get(segIdx) ?? 0) + s.tollCost);
  }

  console.log(`\n📍 Arrêts retenus pour la comparaison (${stops.length}) : stations avec GPS uniquement.`);
  console.log(`   Les ${allStops.length - stops.length} waypoints sans GPS (péages, police, contrôle) sont imputés en péage sur le segment englobant.`);

  // ── Calcul segment par segment (consécutifs) ──────────────────────────────
  const totalDbKm  = route.distanceKm || 1;
  const basePrice   = route.basePrice || 0;
  const rows: SegmentRow[] = [];

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const distDb = Math.max(0, b.distanceFromOriginKm - a.distanceFromOriginKm);

    let distGoogle = 0;
    let durationMin: number | null = null;
    let usedProvider: string = provider.name;

    if (a.coords && b.coords) {
      const res = await provider.getDistance(a.coords, b.coords);
      distGoogle   = res.distanceKm;
      durationMin  = res.durationMin;
      usedProvider = res.provider;
    } else {
      usedProvider = 'MISSING_COORDS';
    }

    // Péage du segment = péage de la station d'arrivée + péages des markers (péage,
    // police, contrôle) sans GPS qui tombent entre a et b dans l'ordre d'itinéraire.
    const aggregatedToll = (b.tollCost ?? 0) + (segmentTollByIndex.get(i) ?? 0);

    rows.push({
      from:        a.name,
      to:          b.name,
      distDb,
      distGoogle,
      priceBefore: 0, // rempli après, quand on connaît totalDbKm (déjà) / totalGoogleKm
      priceAfter:  0,
      tollXaf:     aggregatedToll,
      provider:    usedProvider,
      durationMin,
    });
  }

  const totalGoogleKm = rows.reduce((s, r) => s + (r.distGoogle || 0), 0) || 1;

  // Application de la formule prorata (identique à RouteService.generateSegmentPriceMatrix)
  // Le full route = basePrice. Les intermédiaires = round(segmentKm / totalKm * basePrice).
  // On applique la formule en "avant" avec totalDbKm, en "après" avec totalGoogleKm.
  for (const r of rows) {
    r.priceBefore = Math.round((r.distDb     / totalDbKm)     * basePrice);
    r.priceAfter  = Math.round((r.distGoogle / totalGoogleKm) * basePrice);
  }

  // ── Affichage du tableau (avec colonne péage) ─────────────────────────────
  console.log(`\n📊 Tableau comparatif (${rows.length} segments consécutifs) :\n`);
  console.log(
    '  ' + [
      '#'.padStart(2),
      'Segment'.padEnd(44),
      'DistAvant'.padStart(10),
      'DistAprès'.padStart(10),
      'PrixAvant'.padStart(14),
      'PrixAprès'.padStart(14),
      'Péage'.padStart(12),
      'Provider'.padEnd(10),
      'Δ km'.padStart(8),
    ].join('  '),
  );
  console.log('  ' + '─'.repeat(135));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const deltaKm = (r.distGoogle - r.distDb).toFixed(1);
    const seg = `${r.from.slice(0, 20)} → ${r.to.slice(0, 20)}`;
    console.log(
      '  ' + [
        String(i + 1).padStart(2),
        seg.padEnd(44),
        fmtKm(r.distDb),
        fmtKm(r.distGoogle),
        fmtMoney(r.priceBefore),
        fmtMoney(r.priceAfter),
        r.tollXaf > 0 ? fmtMoney(r.tollXaf) : '—'.padStart(12),
        r.provider.padEnd(10),
        (Number(deltaKm) >= 0 ? '+' : '') + `${deltaKm}`.padStart(7),
      ].join('  '),
    );
  }

  const sumDistBefore   = rows.reduce((s, r) => s + r.distDb,     0);
  const sumDistAfter    = rows.reduce((s, r) => s + r.distGoogle, 0);
  const sumPriceBefore  = rows.reduce((s, r) => s + r.priceBefore, 0);
  const sumPriceAfter   = rows.reduce((s, r) => s + r.priceAfter,  0);
  const sumToll         = rows.reduce((s, r) => s + r.tollXaf,     0);

  console.log('  ' + '─'.repeat(135));
  console.log(
    '  ' + [
      ''.padStart(2),
      'TOTAL'.padEnd(44),
      fmtKm(sumDistBefore),
      fmtKm(sumDistAfter),
      fmtMoney(sumPriceBefore),
      fmtMoney(sumPriceAfter),
      fmtMoney(sumToll),
      ''.padEnd(10),
      ''.padStart(8),
    ].join('  '),
  );
  console.log(
    '\n  Note : les péages sont comptés séparément dans le coût d\'exploitation (ProfitabilityService.computeTotalToll),\n' +
    '         PAS dans le prix du billet. Le billet reste au prix prorata distance + majoration tenant (peakPeriods, fareClass).\n',
  );

  // Totaux route (pour comparaison directe avec ce que stocke la DB)
  const totalToll = stops.reduce((s, x) => s + x.tollCost, 0);
  console.log(`\n🧾 Totaux :`);
  console.log(`   Distance DB (Route.distanceKm)   : ${route.distanceKm} km`);
  console.log(`   Distance DB (Σ segments waypoints): ${sumDistBefore} km`);
  console.log(`   Distance Google (Σ segments)      : ${sumDistAfter.toFixed(1)} km`);
  console.log(`   Écart Google vs DB                 : ${(sumDistAfter - route.distanceKm).toFixed(1)} km ` +
    `(${route.distanceKm > 0 ? (((sumDistAfter - route.distanceKm) / route.distanceKm) * 100).toFixed(1) : '—'} %)`);
  console.log(`   BasePrice route                    : ${basePrice.toLocaleString('fr-FR')} XAF`);
  console.log(`   Σ segments prix avant (doit ≈ base): ${sumPriceBefore.toLocaleString('fr-FR')} XAF`);
  console.log(`   Σ segments prix après              : ${sumPriceAfter.toLocaleString('fr-FR')} XAF`);
  console.log(`   Péages cumulés déclarés            : ${totalToll.toLocaleString('fr-FR')} XAF`);

  await prisma.$disconnect();
  console.log('\n✅ Terminé.\n');
}

main().catch(async (err) => {
  console.error('💥 Erreur :', err);
  process.exit(1);
});
