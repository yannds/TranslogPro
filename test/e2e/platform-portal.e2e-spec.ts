/**
 * Platform Portal — e2e spec
 *
 * Couvre les nouveaux endpoints SaaS :
 *   /platform/config       (CRUD config plateforme)
 *   /platform/plans        (catalogue + CRUD)
 *   /platform/billing/*    (subscriptions + invoices)
 *   /platform/support/*    (queue plateforme)
 *   /support/tickets       (tenant → plateforme)
 *
 * Stratégie :
 *   - Infra mockée in-memory (Prisma, Redis, Vault).
 *   - Auth via header x-test-user — on injecte un user plateforme (tenantId=nil)
 *     pour les endpoints .global, et un user tenant normal pour /support/tickets.
 *   - Les permissions sont mockées en autorisant tout via PermissionGuard
 *     (rolePermission.findFirst retourne toujours une ligne).
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, AUTH_HEADERS, TENANT_ID, USER_ID } from '../helpers/create-test-app';

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

// ─── Headers ────────────────────────────────────────────────────────────────

const platformSA = {
  'x-test-user': JSON.stringify({
    id: 'sa-user-01', tenantId: PLATFORM_TENANT_ID, roleId: 'role-sa',
    roleName: 'SUPER_ADMIN', userType: 'STAFF',
  }),
};

const tenantAdmin = AUTH_HEADERS.admin;

// ─── Setup ─────────────────────────────────────────────────────────────────

let app: INestApplication;
let prismaMock: ReturnType<typeof import('../helpers/mock-providers').createPrismaMock>;

beforeAll(async () => {
  const testApp = await createTestApp();
  app = testApp.app;
  prismaMock = testApp.prisma;
}, 30_000);

afterAll(async () => {
  await app?.close();
});

// ─── /platform/config ───────────────────────────────────────────────────────

describe('[E2E] /platform/config', () => {
  beforeEach(() => {
    // Mock spécifique PlatformConfig — retourne registre vide
    (prismaMock as unknown as { platformConfig: Record<string, jest.Mock> }).platformConfig = {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany:   jest.fn().mockResolvedValue([]),
      upsert:     jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
  });

  it('GET retourne le registre des clés avec valeurs par défaut (SA seulement)', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/config')
      .set(platformSA)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    // Au moins les 6 clés du registre initial
    expect(res.body.length).toBeGreaterThanOrEqual(6);
    const risk = res.body.find((e: { key: string }) => e.key === 'health.riskThreshold');
    expect(risk).toBeDefined();
    expect(risk.default).toBe(60);
    expect(risk.isDefault).toBe(true);
  });

  it('PATCH accepte un batch update valide', async () => {
    await request(app.getHttpServer())
      .patch('/platform/config')
      .set(platformSA)
      .send({ entries: [{ key: 'health.riskThreshold', value: 70 }] })
      .expect(200);
  });

  it('PATCH rejette une valeur hors bornes (400)', async () => {
    await request(app.getHttpServer())
      .patch('/platform/config')
      .set(platformSA)
      .send({ entries: [{ key: 'health.riskThreshold', value: 999 }] })
      .expect(400);
  });

  it('PATCH rejette une clé inconnue (404)', async () => {
    await request(app.getHttpServer())
      .patch('/platform/config')
      .set(platformSA)
      .send({ entries: [{ key: 'evil.key', value: 'x' }] })
      .expect(404);
  });

  it('endpoint non-autorisé sans header x-test-user (401)', async () => {
    await request(app.getHttpServer())
      .get('/platform/config')
      .expect(401);
  });
});

// ─── /platform/plans ───────────────────────────────────────────────────────

describe('[E2E] /platform/plans', () => {
  beforeEach(() => {
    (prismaMock as unknown as { plan: Record<string, jest.Mock> }).plan = {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany:   jest.fn().mockResolvedValue([]),
      create:     jest.fn().mockResolvedValue({ id: 'plan-new', slug: 'starter', modules: [] }),
      update:     jest.fn().mockResolvedValue({ id: 'plan-new', slug: 'starter', modules: [] }),
      delete:     jest.fn().mockResolvedValue({ id: 'plan-new' }),
    };
    (prismaMock as unknown as { planModule: Record<string, jest.Mock> }).planModule = {
      create:     jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    };
  });

  it('GET /platform/plans retourne la liste (SA)', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/plans')
      .set(platformSA)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /platform/plans crée un plan valide', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform/plans')
      .set(platformSA)
      .send({
        slug:         'starter',
        name:         'Starter',
        price:        29,
        currency:     'EUR',
        billingCycle: 'MONTHLY',
        moduleKeys:   ['SCHEDULER'],
      })
      .expect(201);
    expect(res.body.id).toBeDefined();
  });

  it('POST /platform/plans rejette un slug invalide (non kebab-case)', async () => {
    await request(app.getHttpServer())
      .post('/platform/plans')
      .set(platformSA)
      .send({
        slug: 'Not_A_Kebab',
        name: 'X', price: 0, currency: 'EUR', billingCycle: 'MONTHLY',
      })
      .expect(400);
  });

  it('POST /platform/plans rejette currency non-ISO (pas 3 lettres MAJ)', async () => {
    await request(app.getHttpServer())
      .post('/platform/plans')
      .set(platformSA)
      .send({
        slug: 'valid-slug',
        name: 'X', price: 0, currency: 'euro', billingCycle: 'MONTHLY',
      })
      .expect(400);
  });
});

// ─── /platform/plans/catalog (public aux tenants) ──────────────────────────

describe('[E2E] /platform/plans/catalog', () => {
  it('tenant admin peut consulter le catalogue', async () => {
    (prismaMock as unknown as { plan: Record<string, jest.Mock> }).plan = {
      ...(prismaMock as unknown as { plan: Record<string, jest.Mock> }).plan,
      findMany: jest.fn().mockResolvedValue([
        { id: 'p1', slug: 'pro', name: 'Pro', isActive: true, isPublic: true, modules: [] },
      ]),
    };
    const res = await request(app.getHttpServer())
      .get('/platform/plans/catalog')
      .set(tenantAdmin)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── /support/tickets (côté tenant) ────────────────────────────────────────

describe('[E2E] /support/tickets (tenant)', () => {
  beforeEach(() => {
    (prismaMock as unknown as { supportTicket: Record<string, jest.Mock> }).supportTicket = {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany:   jest.fn().mockResolvedValue([]),
      create:     jest.fn().mockResolvedValue({
        id: 'tk-new', tenantId: TENANT_ID, status: 'OPEN', title: 'Bug', priority: 'NORMAL',
      }),
      update:     jest.fn().mockResolvedValue({}),
    };
    (prismaMock as unknown as { supportMessage: Record<string, jest.Mock> }).supportMessage = {
      create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    (prismaMock as unknown as { tenant: Record<string, jest.Mock> }).tenant.findUnique = jest.fn()
      .mockResolvedValue({ id: TENANT_ID, plan: null });
  });

  it('POST crée un ticket valide', async () => {
    const res = await request(app.getHttpServer())
      .post('/support/tickets')
      .set(tenantAdmin)
      .send({
        title: 'Bug manifeste',
        description: 'Crash lors de la génération PDF. Reproduction : trip 42.',
        category: 'BUG',
        priority: 'NORMAL',
      })
      .expect(201);
    expect(res.body.id).toBeDefined();
  });

  it('POST rejette titre trop court (< 3 chars)', async () => {
    await request(app.getHttpServer())
      .post('/support/tickets')
      .set(tenantAdmin)
      .send({ title: 'x', description: 'suffisamment long pour passer' })
      .expect(400);
  });

  it('POST rejette description trop courte (< 10 chars)', async () => {
    await request(app.getHttpServer())
      .post('/support/tickets')
      .set(tenantAdmin)
      .send({ title: 'Assez long', description: 'court' })
      .expect(400);
  });

  it('POST rejette une priorité hors enum', async () => {
    await request(app.getHttpServer())
      .post('/support/tickets')
      .set(tenantAdmin)
      .send({
        title: 'Titre valide',
        description: 'Description valide de plus de 10 caractères',
        priority: 'URGENT', // pas dans l'enum
      })
      .expect(400);
  });

  it('GET retourne la liste (vide mock)', async () => {
    const res = await request(app.getHttpServer())
      .get('/support/tickets')
      .set(tenantAdmin)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('401 sans header x-test-user', async () => {
    await request(app.getHttpServer())
      .post('/support/tickets')
      .send({ title: 'Test', description: 'Lorem ipsum dolor sit amet' })
      .expect(401);
  });
});

// ─── /platform/support/tickets (queue plateforme) ──────────────────────────

describe('[E2E] /platform/support/tickets (queue)', () => {
  it('SA peut lister la queue', async () => {
    (prismaMock as unknown as { supportTicket: Record<string, jest.Mock> }).supportTicket = {
      ...(prismaMock as unknown as { supportTicket: Record<string, jest.Mock> }).supportTicket,
      findMany: jest.fn().mockResolvedValue([]),
    };

    const res = await request(app.getHttpServer())
      .get('/platform/support/tickets')
      .set(platformSA)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('PATCH change le statut du ticket (SA)', async () => {
    (prismaMock as unknown as { supportTicket: Record<string, jest.Mock> }).supportTicket = {
      ...(prismaMock as unknown as { supportTicket: Record<string, jest.Mock> }).supportTicket,
      findUnique: jest.fn().mockResolvedValue({
        id: 'tk-1', tenantId: TENANT_ID, status: 'IN_PROGRESS', priority: 'NORMAL',
      }),
      update: jest.fn().mockResolvedValue({
        id: 'tk-1', status: 'RESOLVED', resolvedAt: new Date(),
      }),
    };

    await request(app.getHttpServer())
      .patch('/platform/support/tickets/tk-1')
      .set(platformSA)
      .send({ status: 'RESOLVED' })
      .expect(200);
  });
});

// ─── /platform/billing/subscriptions ───────────────────────────────────────

describe('[E2E] /platform/billing/subscriptions', () => {
  it('SA peut lister les souscriptions', async () => {
    (prismaMock as unknown as { platformSubscription: Record<string, jest.Mock> }).platformSubscription = {
      findMany:   jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert:     jest.fn(),
      update:     jest.fn(),
    };

    const res = await request(app.getHttpServer())
      .get('/platform/billing/subscriptions')
      .set(platformSA)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST rejette pour le tenant plateforme', async () => {
    await request(app.getHttpServer())
      .post('/platform/billing/subscriptions')
      .set(platformSA)
      .send({ tenantId: PLATFORM_TENANT_ID, planId: 'any' })
      .expect(400);
    // Note : on s'arrête à 400 (BadRequest) — le service refuse avant même de charger le plan
  });
});

// Suppression des variables importées mais non lues
void USER_ID;
