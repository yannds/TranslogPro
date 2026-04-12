/**
 * Trip Lifecycle — Tests d'intégration (DB réelle)
 *
 * Scénario 1 : Cycle nominal complet
 *   PLANNED → OPEN → BOARDING → IN_PROGRESS → COMPLETED
 *
 * Scénario 2 : Pause / Reprise
 *   … → IN_PROGRESS → IN_PROGRESS_PAUSED → IN_PROGRESS → …
 *
 * Scénario 3 : Incident / Résorption
 *   … → IN_PROGRESS → IN_PROGRESS_DELAYED → IN_PROGRESS → COMPLETED
 *
 * Scénario 4 : Annulation depuis OPEN
 *   PLANNED → OPEN → CANCELLED
 */

import { PrismaClient } from '@prisma/client';
import { PrismaService }  from '@infra/database/prisma.service';
import { WorkflowEngine } from '@core/workflow/workflow.engine';
import { AuditService }   from '@core/workflow/audit.service';
import { seedWorkflowConfigs, SEED } from '../setup/seed-workflow-configs';
import { createIntegrationFixtures, IntegrationFixtures } from '../setup/fixtures';

// ─── Setup ────────────────────────────────────────────────────────────────────

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let prismaClient: PrismaClient;
let prisma:   PrismaService;
let engine:   WorkflowEngine;
let fixtures: IntegrationFixtures;

const ACTOR = {
  id:       SEED.actorId,
  tenantId: SEED.tenantId,
  roleId:   SEED.roleId,
  agencyId: SEED.agencyId,
  roleName: 'integration-agent',
};

const persistTrip = async (entity: any, toState: string, p: PrismaService) =>
  (p as any).trip.update({
    where: { id: entity.id },
    data:  { status: toState, version: { increment: 1 } },
  });

async function reloadTrip(id: string) {
  return prismaClient.trip.findUniqueOrThrow({ where: { id } });
}

async function createFreshTrip() {
  return prismaClient.trip.create({
    data: {
      tenantId:            SEED.tenantId,
      routeId:             fixtures.routeId,
      busId:               fixtures.busId,
      driverId:            fixtures.driverId,
      status:              'PLANNED',
      version:             1,
      departureScheduled:  new Date('2026-06-01T08:00:00Z'),
      arrivalScheduled:    new Date('2026-06-01T10:00:00Z'),
    },
  });
}

async function step(tripId: string, action: string, idemSuffix: string) {
  const current = await reloadTrip(tripId);
  return engine.transition(
    current as any,
    { action, actor: ACTOR, idempotencyKey: `${RUN}-trip-${action}-${idemSuffix}` },
    { aggregateType: 'Trip', persist: persistTrip },
  );
}

beforeAll(async () => {
  prismaClient = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  await prismaClient.$connect();

  prisma = prismaClient as unknown as PrismaService;
  (prisma as any).transact = (fn: (tx: PrismaService) => Promise<unknown>) =>
    prismaClient.$transaction((tx) => fn(tx as unknown as PrismaService));

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  engine = new WorkflowEngine(prisma, audit);

  await seedWorkflowConfigs(prismaClient);
  fixtures = await createIntegrationFixtures(prismaClient);
}, 30_000);

afterAll(async () => {
  await prismaClient.$disconnect();
});

// ─── Scénario 1 : Cycle nominal ───────────────────────────────────────────────

describe('Trip Lifecycle — Scénario 1 : cycle nominal', () => {
  let tripId: string;

  beforeAll(async () => {
    tripId = (await createFreshTrip()).id;
  });

  it('ACTIVATE : PLANNED → OPEN', async () => {
    const res = await step(tripId, 'ACTIVATE', 'sc1');
    expect(res.toState).toBe('OPEN');
    const db = await reloadTrip(tripId);
    expect(db.status).toBe('OPEN');
    expect(db.version).toBe(2);
  });

  it('START_BOARDING : OPEN → BOARDING', async () => {
    const res = await step(tripId, 'START_BOARDING', 'sc1');
    expect(res.toState).toBe('BOARDING');
    expect((await reloadTrip(tripId)).version).toBe(3);
  });

  it('DEPART : BOARDING → IN_PROGRESS', async () => {
    const res = await step(tripId, 'DEPART', 'sc1');
    expect(res.toState).toBe('IN_PROGRESS');
    expect((await reloadTrip(tripId)).version).toBe(4);
  });

  it('END_TRIP : IN_PROGRESS → COMPLETED', async () => {
    const res = await step(tripId, 'END_TRIP', 'sc1');
    expect(res.toState).toBe('COMPLETED');
    const db = await reloadTrip(tripId);
    expect(db.status).toBe('COMPLETED');
    expect(db.version).toBe(5);
  });

  it('4 transitions loguées dans WorkflowTransition', async () => {
    const logs = await prismaClient.workflowTransition.findMany({
      where:   { entityId: tripId, entityType: 'Trip' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs).toHaveLength(4);
    expect(logs.map(l => l.action)).toEqual(['ACTIVATE', 'START_BOARDING', 'DEPART', 'END_TRIP']);
  });
});

// ─── Scénario 2 : Pause / Reprise ────────────────────────────────────────────

describe('Trip Lifecycle — Scénario 2 : pause / reprise', () => {
  let tripId: string;

  beforeAll(async () => {
    tripId = (await createFreshTrip()).id;
    // Avancer jusqu'à IN_PROGRESS
    await step(tripId, 'ACTIVATE',       'sc2-act');
    await step(tripId, 'START_BOARDING', 'sc2-sb');
    await step(tripId, 'DEPART',         'sc2-dep');
  });

  it('PAUSE : IN_PROGRESS → IN_PROGRESS_PAUSED', async () => {
    const res = await step(tripId, 'PAUSE', 'sc2');
    expect(res.toState).toBe('IN_PROGRESS_PAUSED');
    expect((await reloadTrip(tripId)).status).toBe('IN_PROGRESS_PAUSED');
  });

  it('RESUME : IN_PROGRESS_PAUSED → IN_PROGRESS', async () => {
    const res = await step(tripId, 'RESUME', 'sc2');
    expect(res.toState).toBe('IN_PROGRESS');
    expect((await reloadTrip(tripId)).status).toBe('IN_PROGRESS');
  });

  it('END_TRIP : IN_PROGRESS → COMPLETED après reprise', async () => {
    const res = await step(tripId, 'END_TRIP', 'sc2');
    expect(res.toState).toBe('COMPLETED');
  });
});

// ─── Scénario 3 : Incident / Résorption ──────────────────────────────────────

describe('Trip Lifecycle — Scénario 3 : incident', () => {
  let tripId: string;

  beforeAll(async () => {
    tripId = (await createFreshTrip()).id;
    await step(tripId, 'ACTIVATE',       'sc3-act');
    await step(tripId, 'START_BOARDING', 'sc3-sb');
    await step(tripId, 'DEPART',         'sc3-dep');
  });

  it('REPORT_INCIDENT : IN_PROGRESS → IN_PROGRESS_DELAYED', async () => {
    const res = await step(tripId, 'REPORT_INCIDENT', 'sc3');
    expect(res.toState).toBe('IN_PROGRESS_DELAYED');
  });

  it('CLEAR_INCIDENT : IN_PROGRESS_DELAYED → IN_PROGRESS', async () => {
    const res = await step(tripId, 'CLEAR_INCIDENT', 'sc3');
    expect(res.toState).toBe('IN_PROGRESS');
  });

  it('END_TRIP : IN_PROGRESS → COMPLETED après résorption', async () => {
    const res = await step(tripId, 'END_TRIP', 'sc3');
    expect(res.toState).toBe('COMPLETED');
  });
});

// ─── Scénario 4 : Annulation ──────────────────────────────────────────────────

describe('Trip Lifecycle — Scénario 4 : annulation', () => {
  let tripId: string;

  beforeAll(async () => {
    tripId = (await createFreshTrip()).id;
    await step(tripId, 'ACTIVATE', 'sc4-act');
  });

  it('CANCEL : OPEN → CANCELLED', async () => {
    const res = await step(tripId, 'CANCEL', 'sc4');
    expect(res.toState).toBe('CANCELLED');
    const db = await reloadTrip(tripId);
    expect(db.status).toBe('CANCELLED');
  });
});
