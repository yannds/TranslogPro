/**
 * [E2E-API] Briefing v2 — signature dessin récursive (trace → save → reload).
 *
 * Objectif produit (mémoire 2026-04-24) :
 *   « Le dessin n'a historiquement jamais marché — tout PR signature doit
 *     passer un test récursif UI → save → reload → rendu avant livraison. »
 *
 * Ce test garantit la propriété récursive côté API :
 *   1. POST /briefings/v2 avec method=DRAW + blob=SVG complexe
 *   2. GET /briefings/assignment/:id
 *   3. Vérifie que le blob SVG retourné est strictement identique au blob posté
 *   4. Vérifie que la méthode est bien DRAW et que acknowledgedByDriverId match
 *
 * En plus, couvre :
 *   - Signature PIN (sha-256 hex de 64 chars) persistée verbatim
 *   - Policy BLOCK_DEPARTURE : mandatory KO sans override → 403
 *   - Policy BLOCK_DEPARTURE : mandatory KO avec override → 200 + override tracé
 *
 * Idempotent, auto-nettoie via rollback Prisma en afterAll.
 */

import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const E2E = {
  TENANT_ID:    '2d48bdfa-5f6e-433d-ba70-5410ca870865',
  HOSTNAME:     'pw-e2e-tenant.translog.test',
  ADMIN_EMAIL:  'e2e-tenant-admin@e2e.local',
  ADMIN_PASSWD: 'Passw0rd!E2E',
} as const;

const SUITE = `pw-brief-sig-${Date.now()}`;

// SVG « complexe » : 2 traits avec points flottants — reproduction fidèle
// du dessin UI (cf. BriefingSignatureInput.tsx et MobileSignatureInput.tsx).
const COMPLEX_SIGNATURE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 180" width="400" height="180">' +
  '<path d="M 10.5 20.3 L 50.2 40.1 L 100.7 35.8 L 150.4 60.9 L 200.1 45.6" ' +
  'fill="none" stroke="#0f172a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M 220.0 80.0 L 260.5 100.3 L 310.2 95.7 L 360.8 130.4" ' +
  'fill="none" stroke="#0f172a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

let prisma: PrismaClient;
let cookie: string;
let adminUserId: string;
let driverStaffId: string;
let driverUserId:  string;
let tripId:        string;
let assignmentId:  string;
let templateId:    string;
let itemMandatoryId: string;

// IDs à cleanup
const createdBriefingIds: string[] = [];
const createdAlertIds:    string[] = [];
const createdAssignmentIds: string[] = [];
const createdTripIds:     string[] = [];

test.describe.serial('[E2E-API] Briefing v2 — signature récursive', () => {

  test.beforeAll(async ({ request }) => {
    prisma = new PrismaClient();
    await prisma.$connect();

    // ── Login admin tenant ─────────────────────────────────────────────
    const loginRes = await request.post(
      `http://${E2E.HOSTNAME}/api/auth/signin`,
      {
        data: { email: E2E.ADMIN_EMAIL, password: E2E.ADMIN_PASSWD },
        ignoreHTTPSErrors: true,
      },
    );
    expect(loginRes.ok()).toBeTruthy();
    const setCookie = loginRes.headers()['set-cookie'] ?? '';
    cookie = setCookie.split(/,\s*(?=[\w-]+=)/).map(c => c.split(';')[0]).join('; ');

    const adminUser = await prisma.user.findFirstOrThrow({
      where: { tenantId: E2E.TENANT_ID, email: E2E.ADMIN_EMAIL },
    });
    adminUserId = adminUser.id;

    // ── Setup minimal : driver staff + trip + assignment ───────────────
    const agency = await prisma.agency.findFirstOrThrow({ where: { tenantId: E2E.TENANT_ID } });
    const route  = await prisma.route.findFirstOrThrow({ where: { tenantId: E2E.TENANT_ID } });
    const bus    = await prisma.bus.findFirstOrThrow({ where: { tenantId: E2E.TENANT_ID } });

    const driverUser = await prisma.user.upsert({
      where:  { id: `${SUITE}-user-driver` },
      create: {
        id:        `${SUITE}-user-driver`,
        tenantId:  E2E.TENANT_ID,
        email:     `${SUITE}-driver@e2e.local`,
        name:      'Driver Sig Test',
        userType:  'STAFF',
        agencyId:  agency.id,
      },
      update: {},
    });
    driverUserId = driverUser.id;

    const staff = await prisma.staff.upsert({
      where:  { userId: driverUser.id },
      create: {
        id:       `${SUITE}-staff`,
        tenantId: E2E.TENANT_ID,
        agencyId: agency.id,
        userId:   driverUser.id,
        status:   'ACTIVE',
        hireDate: new Date(),
      },
      update: {},
    });
    driverStaffId = staff.id;

    const tripCreated = await prisma.trip.create({
      data: {
        tenantId:           E2E.TENANT_ID,
        routeId:            route.id,
        busId:              bus.id,
        driverId:           staff.id,
        status:             'SCHEDULED',
        seatingMode:        'OPEN',
        departureScheduled: new Date(Date.now() + 3_600_000),
        arrivalScheduled:   new Date(Date.now() + 7_200_000),
      },
    });
    tripId = tripCreated.id;
    createdTripIds.push(tripId);

    const assignment = await prisma.crewAssignment.create({
      data: {
        tenantId: E2E.TENANT_ID,
        tripId:   tripId,
        staffId:  staff.id,
        crewRole: 'DRIVER',
        status:   'STANDBY',
      },
    });
    assignmentId = assignment.id;
    createdAssignmentIds.push(assignmentId);

    // ── Récupère template par défaut + un item mandatory pour les tests
    const template = await prisma.briefingTemplate.findFirstOrThrow({
      where:   { tenantId: E2E.TENANT_ID, isDefault: true },
      include: { sections: { include: { items: { where: { isMandatory: true } } } } },
    });
    templateId = template.id;
    const firstMandatory = template.sections
      .flatMap(s => s.items.filter(i => i.kind === 'CHECK' || i.kind === 'DOCUMENT'))[0];
    expect(firstMandatory, 'template seed doit contenir au moins un item mandatory CHECK/DOCUMENT').toBeTruthy();
    itemMandatoryId = firstMandatory.id;
  });

  test.afterAll(async () => {
    // Rollback inversé
    await prisma.tripSafetyAlert.deleteMany({ where: { id: { in: createdAlertIds } } });
    await prisma.crewBriefingRecord.deleteMany({ where: { id: { in: createdBriefingIds } } });
    await prisma.crewAssignment.deleteMany({ where: { id: { in: createdAssignmentIds } } });
    await prisma.trip.deleteMany({ where: { id: { in: createdTripIds } } });
    await prisma.staff.deleteMany({ where: { id: `${SUITE}-staff` } });
    await prisma.user.deleteMany({ where: { id: `${SUITE}-user-driver` } });
    await prisma.$disconnect();
  });

  // ─── TEST 1 : SIGNATURE DRAW RÉCURSIVE (trace → save → reload → verify) ───

  test('DRAW — SVG signature persiste verbatim (propriété récursive)', async ({ request }) => {
    const allItems = await prisma.briefingItem.findMany({
      where: { section: { templateId }, isActive: true },
    });

    const body = {
      assignmentId,
      templateId,
      conductedById: driverStaffId,
      items: allItems.map(i => ({
        itemId: i.id,
        passed: true,
        qty:    i.kind === 'QUANTITY' ? i.requiredQty : 1,
      })),
      driverSignature: {
        method:           'DRAW',
        blob:             COMPLEX_SIGNATURE_SVG,
        acknowledgedById: driverUserId,
      },
    };

    const post = await request.post(
      `http://${E2E.HOSTNAME}/api/tenants/${E2E.TENANT_ID}/crew-briefing/briefings/v2`,
      { data: body, headers: { cookie } },
    );
    expect(post.ok(), await post.text()).toBeTruthy();
    const postJson = await post.json();
    expect(postJson.allEquipmentOk).toBe(true);
    expect(postJson.briefingId).toBeTruthy();
    createdBriefingIds.push(postJson.briefingId);

    // Reload via GET — propriété récursive
    const get = await request.get(
      `http://${E2E.HOSTNAME}/api/tenants/${E2E.TENANT_ID}/crew-briefing/briefings/assignment/${assignmentId}`,
      { headers: { cookie } },
    );
    expect(get.ok()).toBeTruthy();
    const record = await get.json();

    // VÉRIFICATIONS RÉCURSIVES : byte-for-byte identique
    expect(record.driverSignatureMethod).toBe('DRAW');
    expect(record.driverSignatureBlob).toBe(COMPLEX_SIGNATURE_SVG);
    expect(record.acknowledgedByDriverId).toBe(driverUserId);
    expect(record.anomaliesCount).toBe(0);
    expect(record.templateId).toBe(templateId);
    expect(record.driverSignedAt).toBeTruthy();

    // Cleanup briefing pour les tests suivants
    await prisma.crewBriefingRecord.delete({ where: { id: postJson.briefingId } });
    createdBriefingIds.splice(createdBriefingIds.indexOf(postJson.briefingId), 1);
  });

  // ─── TEST 2 : PIN sha-256 persisté verbatim ─────────────────────────────

  test('PIN — hash sha-256 persiste verbatim', async ({ request }) => {
    // sha-256('1234') = 03ac67...
    const PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';

    const allItems = await prisma.briefingItem.findMany({
      where: { section: { templateId }, isActive: true },
    });
    const post = await request.post(
      `http://${E2E.HOSTNAME}/api/tenants/${E2E.TENANT_ID}/crew-briefing/briefings/v2`,
      {
        data: {
          assignmentId, templateId,
          conductedById: driverStaffId,
          items: allItems.map(i => ({
            itemId: i.id, passed: true,
            qty: i.kind === 'QUANTITY' ? i.requiredQty : 1,
          })),
          driverSignature: { method: 'PIN', blob: PIN_HASH, acknowledgedById: driverUserId },
        },
        headers: { cookie },
      },
    );
    expect(post.ok(), await post.text()).toBeTruthy();
    const postJson = await post.json();
    createdBriefingIds.push(postJson.briefingId);

    const get = await request.get(
      `http://${E2E.HOSTNAME}/api/tenants/${E2E.TENANT_ID}/crew-briefing/briefings/assignment/${assignmentId}`,
      { headers: { cookie } },
    );
    const record = await get.json();
    expect(record.driverSignatureMethod).toBe('PIN');
    expect(record.driverSignatureBlob).toBe(PIN_HASH);

    await prisma.crewBriefingRecord.delete({ where: { id: postJson.briefingId } });
    createdBriefingIds.splice(createdBriefingIds.indexOf(postJson.briefingId), 1);
  });

  // ─── TEST 3 : BLOCK_DEPARTURE sans override → 403 ───────────────────────

  test('Policy BLOCK_DEPARTURE — mandatory KO sans override → 403', async ({ request }) => {
    // Active politique BLOCK
    await prisma.tenantBusinessConfig.update({
      where: { tenantId: E2E.TENANT_ID },
      data:  { mandatoryItemFailurePolicy: 'BLOCK_DEPARTURE' },
    });

    const allItems = await prisma.briefingItem.findMany({
      where: { section: { templateId }, isActive: true },
    });

    const res = await request.post(
      `http://${E2E.HOSTNAME}/api/tenants/${E2E.TENANT_ID}/crew-briefing/briefings/v2`,
      {
        data: {
          assignmentId, templateId,
          conductedById: driverStaffId,
          items: allItems.map(i => ({
            itemId: i.id,
            passed: i.id === itemMandatoryId ? false : true, // un mandatory KO
            qty:    i.kind === 'QUANTITY' ? i.requiredQty : 1,
          })),
          driverSignature: { method: 'PIN', blob: 'a'.repeat(64), acknowledgedById: driverUserId },
        },
        headers: { cookie },
      },
    );
    expect(res.status()).toBe(403);

    // Reset policy
    await prisma.tenantBusinessConfig.update({
      where: { tenantId: E2E.TENANT_ID },
      data:  { mandatoryItemFailurePolicy: 'WARN_ONLY' },
    });
  });

  // ─── TEST 4 : BLOCK_DEPARTURE avec override → 200 + override tracé ──────

  test('Policy BLOCK_DEPARTURE — override complet → 200, override audit loggué', async ({ request }) => {
    await prisma.tenantBusinessConfig.update({
      where: { tenantId: E2E.TENANT_ID },
      data:  { mandatoryItemFailurePolicy: 'BLOCK_DEPARTURE' },
    });

    const allItems = await prisma.briefingItem.findMany({
      where: { section: { templateId }, isActive: true },
    });

    const res = await request.post(
      `http://${E2E.HOSTNAME}/api/tenants/${E2E.TENANT_ID}/crew-briefing/briefings/v2`,
      {
        data: {
          assignmentId, templateId,
          conductedById: driverStaffId,
          items: allItems.map(i => ({
            itemId: i.id,
            passed: i.id === itemMandatoryId ? false : true,
            qty:    i.kind === 'QUANTITY' ? i.requiredQty : 1,
          })),
          driverSignature: { method: 'PIN', blob: 'b'.repeat(64), acknowledgedById: driverUserId },
          overrideReason:  'Test override récursif — doc en cours de remplacement',
          overriddenById:  adminUserId,
        },
        headers: { cookie },
      },
    );
    expect(res.ok(), await res.text()).toBeTruthy();
    const json = await res.json();
    createdBriefingIds.push(json.briefingId);

    const record = await prisma.crewBriefingRecord.findUniqueOrThrow({
      where: { id: json.briefingId },
    });
    expect(record.overrideReason).toBe('Test override récursif — doc en cours de remplacement');
    expect(record.overriddenById).toBe(adminUserId);
    expect(record.overriddenAt).toBeTruthy();
    expect(record.anomaliesCount).toBeGreaterThanOrEqual(1);

    // Vérifie alerte sécurité émise
    const alerts = await prisma.tripSafetyAlert.findMany({
      where: { tripId, source: 'BRIEFING' },
    });
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    alerts.forEach(a => createdAlertIds.push(a.id));

    // Reset policy
    await prisma.tenantBusinessConfig.update({
      where: { tenantId: E2E.TENANT_ID },
      data:  { mandatoryItemFailurePolicy: 'WARN_ONLY' },
    });
  });
});
