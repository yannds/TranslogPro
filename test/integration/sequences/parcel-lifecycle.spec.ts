/**
 * Parcel Lifecycle — Tests d'intégration (DB réelle)
 *
 * Scénario 1 : Livraison normale
 *   CREATED → AT_ORIGIN → PACKED → LOADED → IN_TRANSIT → ARRIVED → DELIVERED
 *
 * Scénario 2 : Dommage en transit
 *   … → IN_TRANSIT → DAMAGED
 *
 * Scénario 3 : Perte déclarée
 *   … → IN_TRANSIT → LOST
 *
 * Scénario 4 : Retour depuis ARRIVED
 *   … → ARRIVED → RETURNED
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

const persistParcel = async (entity: any, toState: string, p: PrismaService) =>
  (p as any).parcel.update({
    where: { id: entity.id },
    data:  { status: toState, version: { increment: 1 } },
  });

async function reloadParcel(id: string) {
  return prismaClient.parcel.findUniqueOrThrow({ where: { id } });
}

async function createFreshParcel(suffix: string) {
  return prismaClient.parcel.create({
    data: {
      tenantId:      SEED.tenantId,
      senderId:      fixtures.driverId,
      trackingCode:  `TEST-${Date.now()}-${suffix}`,
      weight:        2.0,
      price:         3000,
      destinationId: fixtures.stationDestinationId,
      recipientInfo: { name: 'Recipient', phone: '+221700000099', address: 'Thiès' },
      status:        'CREATED',
      version:       1,
    },
  });
}

async function step(parcelId: string, action: string, idemSuffix: string) {
  const current = await reloadParcel(parcelId);
  return engine.transition(
    current as any,
    { action, actor: ACTOR, idempotencyKey: `${RUN}-parcel-${action}-${idemSuffix}` },
    { aggregateType: 'Parcel', persist: persistParcel },
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

// ─── Scénario 1 : Livraison normale ──────────────────────────────────────────

describe('Parcel Lifecycle — Scénario 1 : livraison complète', () => {
  let parcelId: string;

  beforeAll(async () => {
    parcelId = (await createFreshParcel('sc1')).id;
  });

  it('RECEIVE : CREATED → AT_ORIGIN', async () => {
    const res = await step(parcelId, 'RECEIVE', 'sc1');
    expect(res.toState).toBe('AT_ORIGIN');
    const db = await reloadParcel(parcelId);
    expect(db.status).toBe('AT_ORIGIN');
    expect(db.version).toBe(2);
  });

  it('ADD_TO_SHIPMENT : AT_ORIGIN → PACKED', async () => {
    const res = await step(parcelId, 'ADD_TO_SHIPMENT', 'sc1');
    expect(res.toState).toBe('PACKED');
    expect((await reloadParcel(parcelId)).version).toBe(3);
  });

  it('LOAD : PACKED → LOADED', async () => {
    const res = await step(parcelId, 'LOAD', 'sc1');
    expect(res.toState).toBe('LOADED');
    expect((await reloadParcel(parcelId)).version).toBe(4);
  });

  it('DEPART : LOADED → IN_TRANSIT', async () => {
    const res = await step(parcelId, 'DEPART', 'sc1');
    expect(res.toState).toBe('IN_TRANSIT');
    expect((await reloadParcel(parcelId)).version).toBe(5);
  });

  it('ARRIVE : IN_TRANSIT → ARRIVED', async () => {
    const res = await step(parcelId, 'ARRIVE', 'sc1');
    expect(res.toState).toBe('ARRIVED');
    expect((await reloadParcel(parcelId)).version).toBe(6);
  });

  it('DELIVER : ARRIVED → DELIVERED', async () => {
    const res = await step(parcelId, 'DELIVER', 'sc1');
    expect(res.toState).toBe('DELIVERED');
    const db = await reloadParcel(parcelId);
    expect(db.status).toBe('DELIVERED');
    expect(db.version).toBe(7);
  });

  it('6 transitions loguées dans WorkflowTransition', async () => {
    const logs = await prismaClient.workflowTransition.findMany({
      where:   { entityId: parcelId, entityType: 'Parcel' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs).toHaveLength(6);
    expect(logs.map(l => l.action)).toEqual([
      'RECEIVE', 'ADD_TO_SHIPMENT', 'LOAD', 'DEPART', 'ARRIVE', 'DELIVER',
    ]);
  });
});

// ─── Scénario 2 : Dommage en transit ─────────────────────────────────────────

describe('Parcel Lifecycle — Scénario 2 : dommage en transit', () => {
  let parcelId: string;

  beforeAll(async () => {
    parcelId = (await createFreshParcel('sc2')).id;
    await step(parcelId, 'RECEIVE',         'sc2');
    await step(parcelId, 'ADD_TO_SHIPMENT', 'sc2');
    await step(parcelId, 'LOAD',            'sc2');
    await step(parcelId, 'DEPART',          'sc2');
  });

  it('DAMAGE : IN_TRANSIT → DAMAGED', async () => {
    const res = await step(parcelId, 'DAMAGE', 'sc2');
    expect(res.toState).toBe('DAMAGED');
    const db = await reloadParcel(parcelId);
    expect(db.status).toBe('DAMAGED');
  });
});

// ─── Scénario 3 : Perte déclarée ─────────────────────────────────────────────

describe('Parcel Lifecycle — Scénario 3 : perte déclarée', () => {
  let parcelId: string;

  beforeAll(async () => {
    parcelId = (await createFreshParcel('sc3')).id;
    await step(parcelId, 'RECEIVE',         'sc3');
    await step(parcelId, 'ADD_TO_SHIPMENT', 'sc3');
    await step(parcelId, 'LOAD',            'sc3');
    await step(parcelId, 'DEPART',          'sc3');
  });

  it('DECLARE_LOST : IN_TRANSIT → LOST', async () => {
    const res = await step(parcelId, 'DECLARE_LOST', 'sc3');
    expect(res.toState).toBe('LOST');
    expect((await reloadParcel(parcelId)).status).toBe('LOST');
  });
});

// ─── Scénario 4 : Retour ─────────────────────────────────────────────────────

describe('Parcel Lifecycle — Scénario 4 : retour depuis ARRIVED', () => {
  let parcelId: string;

  beforeAll(async () => {
    parcelId = (await createFreshParcel('sc4')).id;
    await step(parcelId, 'RECEIVE',         'sc4');
    await step(parcelId, 'ADD_TO_SHIPMENT', 'sc4');
    await step(parcelId, 'LOAD',            'sc4');
    await step(parcelId, 'DEPART',          'sc4');
    await step(parcelId, 'ARRIVE',          'sc4');
  });

  it('RETURN : ARRIVED → RETURNED', async () => {
    const res = await step(parcelId, 'RETURN', 'sc4');
    expect(res.toState).toBe('RETURNED');
    expect((await reloadParcel(parcelId)).status).toBe('RETURNED');
  });
});
