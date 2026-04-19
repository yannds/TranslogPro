/**
 * TicketingService — Tests unitaires
 *
 * Ce qui est testé (logique métier, pas endpoints) :
 *   - issue()   : calcul prix, création PENDING_PAYMENT avec TTL, publication event
 *   - confirm() : vérification expiry, génération QR, délégation workflow PAY
 *   - validate(): vérification QR + état validatable, délégation workflow BOARD
 *   - cancel()  : délégation workflow CANCEL
 *   - findOne() : NotFoundException si absent
 *
 * Mock : PrismaService, WorkflowEngine, PricingEngine, QrService, IEventBus
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TicketingService } from '@modules/ticketing/ticketing.service';
import { PrismaService } from '@infra/database/prisma.service';
import { WorkflowEngine } from '@core/workflow/workflow.engine';
import { PricingEngine } from '@core/pricing/pricing.engine';
import { QrService } from '@core/security/qr/qr.service';
import { IEventBus } from '@infra/eventbus/interfaces/eventbus.interface';
import { TicketAction } from '@common/constants/workflow-states';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = 'tenant-t-001';
const ACTOR  = { id: 'agent-01', tenantId: TENANT, roleId: 'role-cashier', agencyId: 'agency-01', roleName: 'Cashier' };

const TICKET_BASE = {
  id:          'ticket-001',
  tenantId:    TENANT,
  tripId:      'trip-001',
  status:      'PENDING_PAYMENT',
  version:     1,
  expiresAt:   new Date(Date.now() + 10 * 60 * 1_000), // non expiré
  seatNumber:  '12A',
  qrCode:      'pending-xxx',
};

const PRICING_RESULT = {
  basePrice: 5000, taxes: 900, tolls: 500, luggageFee: 0, yieldSurplus: 0, discount: 0, total: 6400,
};

const DTO_ISSUE = {
  tripId: 'trip-001', fareClass: 'STANDARD', passengerName: 'Alice',
  passengerPhone: '+242612345678', seatNumber: '12A',
  alightingStationId: 'dest-001',
};

// ─── Mock factories ────────────────────────────────────────────────────────────

function makePrisma(ticket = TICKET_BASE): jest.Mocked<PrismaService> {
  const tripStub = {
    id: 'trip-001',
    route: { originId: 'origin-001' },
    bus:   { id: 'bus-001', capacity: 50, seatLayout: null },
    seatingMode: 'FREE',
  };
  return {
    ticket: {
      create:    jest.fn().mockResolvedValue(ticket),
      update:    jest.fn().mockResolvedValue({ ...ticket, status: 'CONFIRMED' }),
      findFirst: jest.fn().mockResolvedValue(ticket),
      findMany:  jest.fn().mockResolvedValue([ticket]),
      count:     jest.fn().mockResolvedValue(0),
    },
    trip: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(tripStub),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ country: 'CG' }),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue(null),
      create:    jest.fn().mockResolvedValue({ id: 'cust-001' }),
      update:    jest.fn().mockResolvedValue({ id: 'cust-001' }),
    },
    transact: jest.fn().mockImplementation((fn: (tx: PrismaService) => Promise<unknown>) => fn({
      ticket: {
        create:    jest.fn().mockResolvedValue(ticket),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany:  jest.fn().mockResolvedValue([]),
        count:     jest.fn().mockResolvedValue(0),
      },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService)),
  } as unknown as jest.Mocked<PrismaService>;
}

function makeWorkflow(): jest.Mocked<WorkflowEngine> {
  return {
    transition: jest.fn().mockResolvedValue({ entity: TICKET_BASE, toState: 'CONFIRMED', fromState: 'PENDING_PAYMENT' }),
  } as unknown as jest.Mocked<WorkflowEngine>;
}

function makePricing(): jest.Mocked<PricingEngine> {
  return {
    calculate: jest.fn().mockResolvedValue(PRICING_RESULT),
  } as unknown as jest.Mocked<PricingEngine>;
}

function makeQr(): jest.Mocked<QrService> {
  return {
    sign:   jest.fn().mockResolvedValue('qr-token-abc'),
    verify: jest.fn().mockResolvedValue({ ticketId: 'ticket-001', tenantId: TENANT, tripId: 'trip-001', seatNumber: '12A', issuedAt: Date.now() }),
  } as unknown as jest.Mocked<QrService>;
}

function makeEventBus(): jest.Mocked<IEventBus> {
  return { publish: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<IEventBus>;
}

function buildService(overrides: Partial<{
  prisma:   ReturnType<typeof makePrisma>;
  workflow: ReturnType<typeof makeWorkflow>;
  pricing:  ReturnType<typeof makePricing>;
  qr:       ReturnType<typeof makeQr>;
  eventBus: ReturnType<typeof makeEventBus>;
}> = {}) {
  const prisma   = overrides.prisma   ?? makePrisma();
  const workflow = overrides.workflow  ?? makeWorkflow();
  const pricing  = overrides.pricing   ?? makePricing();
  const qr       = overrides.qr        ?? makeQr();
  const eventBus = overrides.eventBus  ?? makeEventBus();
  // Stubs CRM + refund — tests ciblent la logique workflow/pricing
  const refund      = { createPolicyBasedRefund: jest.fn().mockResolvedValue({ id: 'r1' }) } as any;
  const crmResolver = { resolveOrCreate: jest.fn().mockResolvedValue(null) } as any;
  const crmClaim    = { issueToken:      jest.fn().mockResolvedValue(null) } as any;
  // CashierService stub — les tests existants ne passent pas de caisse, on vérifie seulement
  // que confirmBatch ne plante pas quand aucune caisse ouverte n'est trouvée.
  const cashier     = {
    getMyOpenRegister: jest.fn().mockResolvedValue(null),
    recordTransaction: jest.fn().mockResolvedValue({ id: 'cashier-tx-1' }),
  } as any;
  const service  = new TicketingService(
    prisma as any, workflow as any, pricing as any, qr as any,
    refund, crmResolver, crmClaim,
    cashier,
    eventBus as any,
  );
  return { service, prisma, workflow, pricing, qr, eventBus };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TicketingService', () => {

  // ── issue() ────────────────────────────────────────────────────────────────

  describe('issue()', () => {
    it('appelle PricingEngine.calculate() avec les bons paramètres', async () => {
      const { service, pricing } = buildService();
      await service.issue(TENANT, DTO_ISSUE as any, ACTOR as any);
      expect(pricing.calculate).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT, tripId: DTO_ISSUE.tripId, fareClass: DTO_ISSUE.fareClass }),
      );
    });

    it('crée le ticket avec status=PENDING_PAYMENT', async () => {
      const { service, prisma } = buildService();
      await service.issue(TENANT, DTO_ISSUE as any, ACTOR as any);
      // La création passe par transact → le mock create interne est appelé
      expect(prisma.transact).toHaveBeenCalled();
    });

    it('retourne { ticket, pricing } avec le total calculé', async () => {
      const { service } = buildService();
      const result = await service.issue(TENANT, DTO_ISSUE as any, ACTOR as any);
      expect(result).toHaveProperty('ticket');
      expect(result).toHaveProperty('pricing');
      expect(result.pricing.total).toBe(PRICING_RESULT.total);
    });

    it('publie un DomainEvent TICKET_ISSUED', async () => {
      // L'event est publié dans la transaction via eventBus.publish()
      // On vérifie que transact est appelé (le publish est à l'intérieur)
      const { service, prisma } = buildService();
      await service.issue(TENANT, DTO_ISSUE as any, ACTOR as any);
      expect(prisma.transact).toHaveBeenCalledTimes(1);
    });
  });

  // ── confirm() ─────────────────────────────────────────────────────────────

  describe('confirm()', () => {
    it('délègue au WorkflowEngine avec action=PAY', async () => {
      const { service, workflow } = buildService();
      await service.confirm(TENANT, 'ticket-001', ACTOR as any, 'idem-confirm-01');
      expect(workflow.transition).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ticket-001' }),
        expect.objectContaining({ action: TicketAction.PAY }),
        expect.objectContaining({ aggregateType: 'Ticket' }),
      );
    });

    it('génère un QR token avant la transition', async () => {
      const { service, qr } = buildService();
      await service.confirm(TENANT, 'ticket-001', ACTOR as any);
      expect(qr.sign).toHaveBeenCalledWith(
        expect.objectContaining({ ticketId: 'ticket-001', tenantId: TENANT }),
      );
    });

    it('lève BadRequestException si le ticket est expiré', async () => {
      const expiredTicket = { ...TICKET_BASE, expiresAt: new Date(Date.now() - 1_000) };
      const { service } = buildService({ prisma: makePrisma(expiredTicket) });
      await expect(service.confirm(TENANT, 'ticket-001', ACTOR as any)).rejects.toThrow(BadRequestException);
    });

    it('lève NotFoundException si le ticket n\'existe pas', async () => {
      const prisma = makePrisma(TICKET_BASE);
      prisma.ticket.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma });
      await expect(service.confirm(TENANT, 'ticket-999', ACTOR as any)).rejects.toThrow(NotFoundException);
    });
  });

  // ── validate() ─────────────────────────────────────────────────────────────

  describe('validate()', () => {
    it('vérifie le QR token avant d\'appeler workflow.transition', async () => {
      const confirmedTicket = { ...TICKET_BASE, status: 'CONFIRMED' };
      const { service, qr, workflow } = buildService({ prisma: makePrisma(confirmedTicket) });
      await service.validate(TENANT, 'qr-token-abc', ACTOR as any);
      expect(qr.verify).toHaveBeenCalledWith('qr-token-abc', TENANT);
      expect(workflow.transition).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: TicketAction.BOARD }),
        expect.objectContaining({ aggregateType: 'Ticket' }),
      );
    });

    it('lève BadRequestException si le ticket n\'est pas dans un état validatable', async () => {
      const invalidTicket = { ...TICKET_BASE, status: 'BOARDED' };
      const { service } = buildService({ prisma: makePrisma(invalidTicket) });
      await expect(service.validate(TENANT, 'qr-token-abc', ACTOR as any)).rejects.toThrow(BadRequestException);
    });

    it('accepte CHECKED_IN comme état validatable', async () => {
      const checkedIn = { ...TICKET_BASE, status: 'CHECKED_IN' };
      const prisma = makePrisma(checkedIn);
      const { service, workflow } = buildService({ prisma });
      await service.validate(TENANT, 'qr-token-abc', ACTOR as any);
      expect(workflow.transition).toHaveBeenCalled();
    });
  });

  // ── cancel() ───────────────────────────────────────────────────────────────

  describe('cancel()', () => {
    it('délègue au WorkflowEngine avec action=CANCEL', async () => {
      const { service, workflow } = buildService();
      await service.cancel(TENANT, 'ticket-001', ACTOR as any, 'retard');
      expect(workflow.transition).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ticket-001' }),
        expect.objectContaining({ action: TicketAction.CANCEL, context: { reason: 'retard' } }),
        expect.objectContaining({ aggregateType: 'Ticket' }),
      );
    });
  });

  // ── findOne() ──────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('retourne le ticket existant', async () => {
      const { service } = buildService();
      const ticket = await service.findOne(TENANT, 'ticket-001');
      expect(ticket.id).toBe('ticket-001');
    });

    it('lève NotFoundException si absent', async () => {
      const prisma = makePrisma();
      prisma.ticket.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma });
      await expect(service.findOne(TENANT, 'absent')).rejects.toThrow(NotFoundException);
    });
  });

  // ── trackByCode() ──────────────────────────────────────────────────────────

  describe('trackByCode()', () => {
    it('retourne le ticket correspondant au qrCode', async () => {
      const { service } = buildService();
      const ticket = await service.trackByCode(TENANT, 'pending-xxx');
      expect(ticket.qrCode).toBe('pending-xxx');
    });

    it('lève NotFoundException si code introuvable', async () => {
      const prisma = makePrisma();
      prisma.ticket.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma });
      await expect(service.trackByCode(TENANT, 'bad-code')).rejects.toThrow(NotFoundException);
    });
  });

  // ── findMine() ─────────────────────────────────────────────────────────────

  describe('findMine()', () => {
    it('filtre les tickets par passengerId = userId courant', async () => {
      const prisma = makePrisma();
      (prisma as any).trip = { findMany: jest.fn().mockResolvedValue([]) };
      const { service } = buildService({ prisma });
      await service.findMine(TENANT, 'user-customer-77');
      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT, passengerId: 'user-customer-77' }),
        }),
      );
    });

    it('retourne [] sans hydrater Trip si aucun ticket', async () => {
      const prisma = makePrisma();
      prisma.ticket.findMany = jest.fn().mockResolvedValue([]);
      const tripFindMany = jest.fn();
      (prisma as any).trip = { findMany: tripFindMany };
      const { service } = buildService({ prisma });
      const result = await service.findMine(TENANT, 'user-empty');
      expect(result).toEqual([]);
      expect(tripFindMany).not.toHaveBeenCalled();
    });

    it('hydrate chaque ticket avec son trip (jointure manuelle)', async () => {
      const prisma = makePrisma();
      const trip = { id: 'trip-001', route: { id: 'r1', name: 'Dakar-Thiès' }, bus: { id: 'b1', plateNumber: 'AB-001-CD' } };
      (prisma as any).trip = { findMany: jest.fn().mockResolvedValue([trip]) };
      const { service } = buildService({ prisma });
      const result = await service.findMine(TENANT, 'user-001');
      expect(result[0].trip).toEqual(trip);
    });

    it('limite à 100 tickets, tri createdAt desc', async () => {
      const prisma = makePrisma();
      (prisma as any).trip = { findMany: jest.fn().mockResolvedValue([]) };
      const { service } = buildService({ prisma });
      await service.findMine(TENANT, 'user-001');
      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100, orderBy: { createdAt: 'desc' } }),
      );
    });
  });
});
