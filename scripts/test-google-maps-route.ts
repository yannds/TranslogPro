/**
 * scripts/test-google-maps-route.ts
 *
 * Sanity-check end-to-end du fournisseur Google Maps configuré dans TransLog Pro.
 *
 * Ce script N'utilise que l'application : il boot le contexte Nest complet,
 * résout la clé depuis le Vault via `ISecretService` (exactement comme le code
 * applicatif runtime), appelle `RoutingService.suggestDistance()` (le même
 * code que la modale Création de ligne) et compare le résultat avec :
 *   - La distance stockée sur `Route.distanceKm`
 *   - Les péages déclarés sur les waypoints (`tollCostXaf`)
 *
 * Usage :
 *   npx ts-node scripts/test-google-maps-route.ts [routeId]
 *
 * Sans argument : cherche la route dont le nom contient "Brazza" et "Pointe".
 * Le tenantId est dérivé automatiquement depuis la route trouvée.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { RoutingService } from '../src/modules/routing/routing.service';
import { PlatformConfigService } from '../src/modules/platform-config/platform-config.service';

const DEFAULT_NAME_PATTERNS = ['brazza', 'pointe'];

async function main() {
  console.log('\n🚌 Test Google Maps via TransLog Pro — calcul Brazza ↔ Pointe-Noire\n');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });

  const prisma        = app.get(PrismaService);
  const routing       = app.get(RoutingService);
  const platformConfig= app.get(PlatformConfigService);

  // ── Configuration runtime ────────────────────────────────────────────────
  const enabled  = await platformConfig.getBoolean('routing.enabled').catch(() => false);
  const provider = await platformConfig.getString('routing.provider').catch(() => 'haversine');
  console.log(`🔧 routing.enabled  = ${enabled}`);
  console.log(`🔧 routing.provider = ${provider}`);
  if (!enabled) {
    console.warn('\n⚠️  routing.enabled=false — le RoutingService fera du haversine (ligne droite).\n');
  }
  if (provider !== 'google') {
    console.warn(`\n⚠️  routing.provider=${provider} — pour tester Google il faut 'google'.\n`);
  }

  // ── Résolution de la route cible ─────────────────────────────────────────
  const explicitId = process.argv[2];
  const route = explicitId
    ? await prisma.route.findFirst({
        where:   { id: explicitId },
        include: { origin: true, destination: true, waypoints: { orderBy: { order: 'asc' } } },
      })
    : await prisma.route.findFirst({
        where: {
          AND: DEFAULT_NAME_PATTERNS.map(p => ({ name: { contains: p, mode: 'insensitive' as const } })),
        },
        include: { origin: true, destination: true, waypoints: { orderBy: { order: 'asc' } } },
      });

  if (!route) {
    console.error(`❌ Aucune route trouvée${explicitId ? ` (id=${explicitId})` : ' (pattern brazza+pointe)'}.`);
    await app.close(); process.exit(1);
  }

  console.log(`\n📍 Route trouvée : "${route.name}" (tenant=${route.tenantId})`);
  console.log(`   Origine    : ${route.origin?.name ?? '(sans station)'}`);
  console.log(`   Destination: ${route.destination?.name ?? '(sans station)'}`);
  console.log(`   Distance stockée : ${route.distanceKm} km`);
  console.log(`   Prix de base    : ${route.basePrice}`);

  // ── Péage total déclaré (ligne + waypoints) ──────────────────────────────
  const po = (typeof route.pricingOverrides === 'object' && route.pricingOverrides !== null)
    ? route.pricingOverrides as Record<string, any>
    : {};
  const routeTollOverride = po.tolls?.override as number | undefined;

  const waypointTolls = route.waypoints.reduce((s, w) => {
    const ckpts = Array.isArray((w as any).checkpointCosts) ? ((w as any).checkpointCosts as Array<{ costXaf?: number }>) : [];
    const ckptSum = ckpts.reduce((a, c) => a + (typeof c.costXaf === 'number' ? c.costXaf : 0), 0);
    return s + (w.tollCostXaf ?? 0) + ckptSum;
  }, 0);

  console.log(`\n💰 Péages cumulés sur cette ligne :`);
  if (routeTollOverride !== undefined) {
    console.log(`   Override route   : ${routeTollOverride}`);
  }
  console.log(`   Waypoints total  : ${waypointTolls}`);
  console.log(`   Arrêts (waypoints) : ${route.waypoints.length}`);
  for (const w of route.waypoints) {
    console.log(`     · #${w.order} ${w.name ?? '(sans nom)'} — toll=${w.tollCostXaf ?? 0} — distance=${w.distanceFromOriginKm ?? '?'} km`);
  }

  // ── Extraction des coordonnées GPS ───────────────────────────────────────
  const extractCoords = (row: { coordinates: unknown } | null) => {
    if (!row?.coordinates || typeof row.coordinates !== 'object') return null;
    const c = row.coordinates as Record<string, unknown>;
    const lat = typeof c.lat === 'number' ? c.lat : null;
    const lng = typeof c.lng === 'number' ? c.lng : null;
    return lat !== null && lng !== null ? { lat, lng } : null;
  };
  const origin = extractCoords(route.origin as any);
  const dest   = extractCoords(route.destination as any);

  if (!origin || !dest) {
    console.error('\n❌ Une station n\'a pas de coordonnées GPS — impossible de tester Google.');
    console.error(`   origin.coords = ${JSON.stringify(route.origin?.coordinates)}`);
    console.error(`   dest.coords   = ${JSON.stringify(route.destination?.coordinates)}`);
    await app.close(); process.exit(2);
  }
  console.log(`\n🌐 Coordonnées GPS :`);
  console.log(`   Origine    : ${origin.lat}, ${origin.lng}`);
  console.log(`   Destination: ${dest.lat}, ${dest.lng}`);

  // ── Appel EXACT de notre service (même code que la modale front) ─────────
  console.log(`\n⏱️  Appel RoutingService.suggestDistance() ...`);
  const t0 = Date.now();
  const result = await routing.suggestDistance(origin, dest);
  const ms = Date.now() - t0;
  console.log(`   Réponse en ${ms} ms`);

  console.log(`\n✅ Résultat provider "${result.provider}" :`);
  console.log(`   distanceKm  = ${result.distanceKm} km`);
  console.log(`   durationMin = ${result.durationMin ?? '—'} min`);
  console.log(`   estimated   = ${result.estimated}`);

  // ── Comparaison ──────────────────────────────────────────────────────────
  const delta   = Math.round((result.distanceKm - route.distanceKm) * 10) / 10;
  const deltaPct = route.distanceKm > 0
    ? Math.round((delta / route.distanceKm) * 1000) / 10
    : 0;

  console.log(`\n📊 Comparaison :`);
  console.log(`   DB    : ${route.distanceKm} km`);
  console.log(`   ${result.provider.padEnd(5)} : ${result.distanceKm} km`);
  console.log(`   Δ     : ${delta >= 0 ? '+' : ''}${delta} km (${deltaPct >= 0 ? '+' : ''}${deltaPct} %)`);

  if (result.provider === 'haversine') {
    console.log('\n⚠️  Le provider actif est haversine — soit Google a échoué (fallback),');
    console.log('    soit la config `routing.provider` n\'est pas `google`, soit la clé Vault est absente.');
    console.log('    Vérifie les logs backend (grep "\\[Routing\\]" ou "\\[Google\\]").');
  } else if (Math.abs(deltaPct) > 15) {
    console.log('\n⚠️  Écart > 15 % — soit la distance DB est obsolète, soit les coords GPS sont fausses.');
  } else {
    console.log('\n✅ Écart cohérent — la distance DB est alignée avec Google Maps.');
  }

  await app.close();
}

main().catch(err => {
  console.error('💥 Erreur :', err);
  process.exit(1);
});
