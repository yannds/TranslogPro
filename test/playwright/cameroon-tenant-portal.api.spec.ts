/**
 * E2E API test — Tenant Cameroun (CM) sur le portail public.
 *
 * Vérifie :
 *   [CMR-1] Endpoints publics répondent 200 sur un tenant frais (pas de régression).
 *   [CMR-2] /portal/config expose `tenant.country = "CM"` — drive le préfixe
 *           téléphonique côté FE (placeholder devient `+237 …`).
 *   [CMR-3] /portal/popular-routes retourne `[]` pour un tenant sans billets vendus
 *           (problème "Brazzaville hardcodé" — n'apparaît plus pour un tenant CM).
 *   [CMR-4] /portal/stations retourne `[]` (pas de seed Congo "imposé" sur un nouveau tenant).
 *   [CMR-5] Avec 1 trajet réel Yaoundé→Douala et 1 billet confirmé,
 *           popular-routes retourne UNIQUEMENT ce trajet — zéro fuite cross-tenant
 *           ni fallback hardcodé Congo.
 */
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? 'postgresql://app_user:app_password@localhost:5434/translog' } },
});

const CONGO_CITIES = ['Brazzaville', 'Pointe-Noire', 'Dolisie', 'Ouesso'];

interface CmFixture {
  tenantId: string;
  slug:     string;
  hostname: string;
  yaoundeId: string;
  doualaId:  string;
  routeId:   string;
  busId:     string;
  tripId:    string;
}

async function createCameroonTenant(): Promise<CmFixture> {
  const ts   = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const slug = `pw-cm-${ts}-${rand}`;

  const tenant = await prisma.tenant.create({
    data: {
      name:            `Playwright Cameroun ${slug}`,
      slug,
      country:         'CM',
      currency:        'XAF',
      timezone:        'Africa/Douala',
      language:        'fr',
      isActive:        true,
      provisionStatus: 'ACTIVE',
    },
  });
  const hostname = `${slug}.translog.test`;
  await prisma.tenantDomain.create({
    data: { tenantId: tenant.id, hostname, isPrimary: true, verifiedAt: new Date() },
  });

  // Stations Cameroun — Yaoundé + Douala (les deux principales du pays).
  // On les crée pour pouvoir bâtir une route + trip + ticket dans le scénario [CMR-5].
  const yaounde = await prisma.station.create({
    data: { tenantId: tenant.id, name: 'Yaoundé Centre', city: 'Yaoundé', type: 'PRINCIPALE',
            coordinates: { lat: 3.8480, lng: 11.5021 } },
  });
  const douala = await prisma.station.create({
    data: { tenantId: tenant.id, name: 'Douala Centre', city: 'Douala', type: 'PRINCIPALE',
            coordinates: { lat: 4.0511, lng: 9.7679 } },
  });

  const route = await prisma.route.create({
    data: {
      tenantId:      tenant.id,
      name:          'Yaoundé → Douala',
      originId:      yaounde.id,
      destinationId: douala.id,
      distanceKm:    245,
      basePrice:     6500,
    },
  });

  const bus = await prisma.bus.create({
    data: {
      tenantId:          tenant.id,
      plateNumber:       `CM-${rand}-A`,
      model:             'Coaster',
      type:              'STANDARD',
      capacity:          30,
      luggageCapacityKg: 200,
      luggageCapacityM3: 5,
      year:              2020,
      status:            'AVAILABLE',
    },
  });

  const driver = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email:    `driver-${rand}@pw.local`,
      name:     'PW Driver',
      userType: 'STAFF',
      isActive: true,
    },
  });

  const trip = await prisma.trip.create({
    data: {
      tenantId:           tenant.id,
      routeId:            route.id,
      busId:              bus.id,
      driverId:           driver.id,
      status:             'COMPLETED',
      // Billets datés des derniers jours pour rentrer dans la fenêtre 90j de popular-routes.
      departureScheduled: new Date(Date.now() - 5 * 86_400_000),
      arrivalScheduled:   new Date(Date.now() - 5 * 86_400_000 + 4 * 3_600_000), // 4h
    },
  });

  return {
    tenantId: tenant.id,
    slug,
    hostname,
    yaoundeId: yaounde.id,
    doualaId:  douala.id,
    routeId:   route.id,
    busId:     bus.id,
    tripId:    trip.id,
  };
}

async function seedConfirmedTickets(f: CmFixture, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await prisma.ticket.create({
      data: {
        id:                 uuidv4(),
        tenantId:           f.tenantId,
        tripId:             f.tripId,
        passengerName:      `Passenger ${i}`,
        boardingStationId:  f.yaoundeId,
        alightingStationId: f.doualaId,
        fareClass:          'STANDARD',
        pricePaid:          6500,
        status:             'COMPLETED',
        qrCode:             `qr-${f.slug}-${i}`,
        version:            1,
      },
    });
  }
}

async function cleanup(tenantId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
    await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, tenantId);
  });
}

/**
 * Vide le cache Redis du portail pour le tenant donné — sinon les requêtes
 * `popular-routes` répondent depuis le cache (TTL 5 min) et masquent les
 * mutations DB faites pendant le test.
 */
function flushPortalCache(slug: string, tenantId: string): void {
  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    execSync(
      `docker exec translog-redis redis-cli -a redis_password --no-auth-warning DEL portal:slug:${slug} portal:popular:${tenantId} > /dev/null 2>&1`,
      { timeout: 3000 },
    );
  } catch { /* best-effort */ }
}

test.describe('[E2E-API] Tenant Cameroun — portail public', () => {
  let cm: CmFixture;

  test.beforeAll(async () => {
    cm = await createCameroonTenant();
  });

  test.afterAll(async () => {
    await cleanup(cm.tenantId);
    await prisma.$disconnect();
  });

  test('[CMR-1..4] tenant CM frais — pas d\'erreur, pas de Congo, popular-routes vide', async ({ request }) => {
    const base    = `/api/public/${cm.slug}/portal`;
    const headers = { Host: cm.hostname };

    // [CMR-1] Endpoints existants — non-régression.
    const config = await request.get(`${base}/config`, { headers });
    expect(config.status(), `config: ${await config.text()}`).toBe(200);
    const cfgBody = await config.json();

    // [CMR-2] country = CM exposé → FE peut dériver +237 pour les placeholders.
    expect(cfgBody.tenant.country).toBe('CM');
    expect(cfgBody.tenant.slug).toBe(cm.slug);

    // [CMR-1 cont.] Autres endpoints publics répondent 200.
    const annc     = await request.get(`${base}/announcements`,    { headers });
    const footer   = await request.get(`${base}/footer-pages`,     { headers });
    const pages    = await request.get(`${base}/pages`,            { headers });
    const stations = await request.get(`${base}/stations`,         { headers });
    const fleet    = await request.get(`${base}/fleet`,            { headers });
    expect(annc.status()).toBe(200);
    expect(footer.status()).toBe(200);
    expect(pages.status()).toBe(200);
    expect(stations.status()).toBe(200);
    expect(fleet.status()).toBe(200);

    // [CMR-4] Stations seedées Cameroun, aucune Congo.
    const stBody = await stations.json() as Array<{ city: string; name: string }>;
    const cities = stBody.map(s => s.city);
    expect(cities).toEqual(expect.arrayContaining(['Yaoundé', 'Douala']));
    for (const congoCity of CONGO_CITIES) {
      expect(cities, `aucune ville Congo dans le tenant CM`).not.toContain(congoCity);
    }

    // [CMR-3] Pas encore de billets → popular-routes vide.
    const popular0 = await request.get(`${base}/popular-routes`, { headers });
    expect(popular0.status(), `popular-routes: ${await popular0.text()}`).toBe(200);
    const popular0Body = await popular0.json() as unknown[];
    expect(Array.isArray(popular0Body)).toBe(true);
    expect(popular0Body).toHaveLength(0);

    // Garde-fou anti-régression : le payload JSON ne mentionne aucune ville Congo
    // — détecte un éventuel fallback hardcodé qui aurait survécu côté backend.
    const fullBody = JSON.stringify(popular0Body) + JSON.stringify(cfgBody) + JSON.stringify(stBody);
    for (const congoCity of CONGO_CITIES) {
      expect(fullBody, `aucune référence "${congoCity}" pour un tenant CM`)
        .not.toContain(congoCity);
    }
  });

  test('[CMR-5] popular-routes agrège uniquement les billets du tenant CM', async ({ request }) => {
    const base    = `/api/public/${cm.slug}/portal`;
    const headers = { Host: cm.hostname };

    // 3 billets confirmés Yaoundé→Douala. Pas le seul OD au monde mais le seul
    // de ce tenant — la requête doit donc renvoyer EXACTEMENT cette ligne.
    await seedConfirmedTickets(cm, 3);
    flushPortalCache(cm.slug, cm.tenantId);

    const popular = await request.get(`${base}/popular-routes`, { headers });
    expect(popular.status(), `popular-routes: ${await popular.text()}`).toBe(200);
    const body = await popular.json() as Array<{
      from: string; to: string; price: number; durationMinutes: number | null;
    }>;

    expect(body).toHaveLength(1);
    expect(body[0].from).toBe('Yaoundé');
    expect(body[0].to).toBe('Douala');
    expect(body[0].price).toBe(6500);
    // 4h trajet → ~240 min (peut varier selon la précision de l'arrondi)
    expect(body[0].durationMinutes).toBeGreaterThan(200);
    expect(body[0].durationMinutes).toBeLessThan(280);

    // Garde-fou : zéro mention Congo dans le payload.
    const raw = JSON.stringify(body);
    for (const congoCity of CONGO_CITIES) {
      expect(raw).not.toContain(congoCity);
    }
  });
});
