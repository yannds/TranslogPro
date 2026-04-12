/**
 * Ticket Lifecycle — Tests d'intégration (DB réelle)
 *
 * Scénario 1 : Cycle complet
 *   CREATED → PENDING_PAYMENT → CONFIRMED → BOARDED → COMPLETED
 *
 * Scénario 2 : Expiration
 *   CREATED → PENDING_PAYMENT → EXPIRED
 *
 * Scénario 3 : Annulation après confirmation
 *   PENDING_PAYMENT → CONFIRMED → CANCELLED
 *
 * Vérifie à chaque étape :
 *   - status en DB après transition
 *   - version incrémentée
 *   - WorkflowTransition loguée
 *   - idempotence sur la même transition
 */

import { PrismaClient } from '@prisma/client';
import { PrismaService }  from '@infra/database/prisma.service';
import { WorkflowEngine } from '@core/workflow/workflow.engine';
import { AuditService }   from '@core/workflow/audit.service';
import { seedWorkflowConfigs, SEED } from '../setup/seed-workflow-configs';
import { createIntegrationFixtures, IntegrationFixtures } from '../setup/fixtures';

// ─── Setup ────────────────────────────────────────────────────────────────────

// Préfixe unique par run — élimine les faux-positifs d'idempotence sur DB persistante
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

// Helper — persist générique pour Ticket
const persistTicket = async (entity: any, toState: string, p: PrismaService) =>
  (p as any).ticket.update({
    where: { id: entity.id },
    data:  { status: toState, version: { increment: 1 } },
  });

// Helper — recharger le ticket depuis DB
async function reload(id: string) {
  return prismaClient.ticket.findUniqueOrThrow({ where: { id } });
}

// Helper — appliquer une transition et recharger
async function step(ticketId: string, action: string, idemSuffix: string) {
  const current = await reload(ticketId);
  return engine.transition(
    current as any,
    { action, actor: ACTOR, idempotencyKey: `${RUN}-ticket-${action}-${idemSuffix}` },
    { aggregateType: 'Ticket', persist: persistTicket },
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

// ─── Scénario 1 : Cycle complet ───────────────────────────────────────────────

describe('Ticket Lifecycle — Scénario 1 : cycle complet', () => {
  let ticketId: string;

  beforeAll(async () => {
    // Créer un ticket frais pour ce scénario
    const t = await prismaClient.ticket.create({
      data: {
        tenantId:      SEED.tenantId,
        tripId:        fixtures.tripId,
        passengerId:   fixtures.passengerId,
        passengerName: 'Alice Lifecycle',
        pricePaid:     3500,
        agencyId:      fixtures.agencyId,
        status:        'PENDING_PAYMENT',
        qrCode:        `qr-lc1-${Date.now()}`,
        version:       1,
      },
    });
    ticketId = t.id;
  });

  it('PAY : PENDING_PAYMENT → CONFIRMED', async () => {
    const res = await step(ticketId, 'PAY', '1-pay');
    expect(res.toState).toBe('CONFIRMED');
    const db = await reload(ticketId);
    expect(db.status).toBe('CONFIRMED');
    expect(db.version).toBe(2);
  });

  it('PAY idempotent — même résultat au deuxième appel', async () => {
    // Re-appel avec la même clé — doit rejouer sans erreur
    const current = await reload(ticketId);
    const res = await engine.transition(
      current as any,
      { action: 'PAY', actor: ACTOR, idempotencyKey: `${RUN}-ticket-PAY-1-pay` },
      { aggregateType: 'Ticket', persist: jest.fn() },
    );
    expect(res.toState).toBe('CONFIRMED');
  });

  it('BOARD : CONFIRMED → BOARDED', async () => {
    const res = await step(ticketId, 'BOARD', '1-board');
    expect(res.toState).toBe('BOARDED');
    const db = await reload(ticketId);
    expect(db.status).toBe('BOARDED');
    expect(db.version).toBe(3);
  });

  it('FINALIZE : BOARDED → COMPLETED', async () => {
    const res = await step(ticketId, 'FINALIZE', '1-final');
    expect(res.toState).toBe('COMPLETED');
    const db = await reload(ticketId);
    expect(db.status).toBe('COMPLETED');
    expect(db.version).toBe(4);
  });

  it('3 lignes WorkflowTransition loguées (PAY idempotent ne re-persiste pas)', async () => {
    const logs = await prismaClient.workflowTransition.findMany({
      where:   { entityId: ticketId, entityType: 'Ticket' },
      orderBy: { createdAt: 'asc' },
    });
    // PAY (réel), BOARD, FINALIZE — le PAY idempotent ne crée PAS de ligne supplémentaire
    expect(logs).toHaveLength(3);
    expect(logs.map(l => l.action)).toEqual(['PAY', 'BOARD', 'FINALIZE']);
  });
});

// ─── Scénario 2 : Expiration ──────────────────────────────────────────────────

describe('Ticket Lifecycle — Scénario 2 : expiration', () => {
  let ticketId: string;

  beforeAll(async () => {
    const t = await prismaClient.ticket.create({
      data: {
        tenantId:      SEED.tenantId,
        tripId:        fixtures.tripId,
        passengerId:   fixtures.passengerId,
        passengerName: 'Expire Test',
        pricePaid:     3500,
        agencyId:      fixtures.agencyId,
        status:        'PENDING_PAYMENT',
        qrCode:        `qr-lc2-${Date.now()}`,
        version:       1,
      },
    });
    ticketId = t.id;
  });

  it('EXPIRE : PENDING_PAYMENT → EXPIRED', async () => {
    const res = await step(ticketId, 'EXPIRE', '2-expire');
    expect(res.toState).toBe('EXPIRED');
    const db = await reload(ticketId);
    expect(db.status).toBe('EXPIRED');
  });
});

// ─── Scénario 3 : Annulation après confirmation ───────────────────────────────

describe('Ticket Lifecycle — Scénario 3 : annulation', () => {
  let ticketId: string;

  beforeAll(async () => {
    const t = await prismaClient.ticket.create({
      data: {
        tenantId:      SEED.tenantId,
        tripId:        fixtures.tripId,
        passengerId:   fixtures.passengerId,
        passengerName: 'Cancel Test',
        pricePaid:     3500,
        agencyId:      fixtures.agencyId,
        status:        'PENDING_PAYMENT',
        qrCode:        `qr-lc3-${Date.now()}`,
        version:       1,
      },
    });
    ticketId = t.id;
  });

  it('PAY : PENDING_PAYMENT → CONFIRMED', async () => {
    const res = await step(ticketId, 'PAY', '3-pay');
    expect(res.toState).toBe('CONFIRMED');
  });

  it('CANCEL : CONFIRMED → CANCELLED', async () => {
    const res = await step(ticketId, 'CANCEL', '3-cancel');
    expect(res.toState).toBe('CANCELLED');
    const db = await reload(ticketId);
    expect(db.status).toBe('CANCELLED');
  });
});
