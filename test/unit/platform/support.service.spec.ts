/**
 * SupportService — tests unitaires
 *
 * Couvre :
 *   - createByTenant : interdit aux users plateforme
 *   - createByTenant : crée ticket + premier message (description)
 *   - resolveSla : priorité cappée par plan.sla.maxPriority
 *   - resolveSla : SLA depuis plan.sla.firstResponseMinByPriority en priorité
 *   - findByTenant : rejette si tenantId mismatch (tenant isolation)
 *   - addMessageByPlatform : met à jour firstResponseAt au 1er message externe
 *   - addMessageByPlatform : note interne ne change pas le status
 */

import { SupportService } from '../../../src/modules/support/support.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const TENANT_A = 'tenant-aaaa';
const TENANT_B = 'tenant-bbbb';

function createPrismaMock() {
  const tickets = new Map<string, Record<string, unknown>>();
  const messages: Array<Record<string, unknown>> = [];
  const tenants = new Map<string, Record<string, unknown>>();
  return {
    supportTicket: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const t = { id: `tk-${tickets.size + 1}`, ...data };
        tickets.set(String(t.id), t);
        return t;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const tk = tickets.get(where.id);
        if (!tk) return null;
        return { ...tk, messages: messages.filter(m => m.ticketId === tk.id && !m.isInternal) };
      }),
      findMany: jest.fn(async () => Array.from(tickets.values())),
      update:   jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = tickets.get(where.id);
        if (!existing) throw new Error('404');
        const next = { ...existing, ...data };
        tickets.set(where.id, next);
        return next;
      }),
    },
    supportMessage: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const m = { id: `msg-${messages.length + 1}`, createdAt: new Date(), ...data };
        messages.push(m);
        return m;
      }),
    },
    tenant: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => tenants.get(where.id) ?? null),
    },
    __tickets: tickets,
    __messages: messages,
    __tenants: tenants,
  };
}

describe('SupportService', () => {
  describe('createByTenant', () => {
    it('rejette un actor du tenant plateforme', async () => {
      const prisma = createPrismaMock();
      prisma.__tenants.set(PLATFORM_TENANT_ID, { id: PLATFORM_TENANT_ID, plan: null });
      const svc = new SupportService(prisma as never);

      await expect(svc.createByTenant(
        { id: 'u', tenantId: PLATFORM_TENANT_ID },
        { title: 'Bug', description: 'Une description complète' },
      )).rejects.toThrow(ForbiddenException);
    });

    it('crée le ticket + un premier message TENANT', async () => {
      const prisma = createPrismaMock();
      prisma.__tenants.set(TENANT_A, { id: TENANT_A, plan: null });
      const svc = new SupportService(prisma as never);

      await svc.createByTenant(
        { id: 'user-1', tenantId: TENANT_A },
        { title: 'Bug manifeste', description: 'Crash à la génération du PDF' },
      );

      expect(prisma.supportTicket.create).toHaveBeenCalled();
      expect(prisma.supportMessage.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ authorScope: 'TENANT', body: 'Crash à la génération du PDF' }),
      }));
    });

    it('calcule un slaDueAt pour priorité NORMAL (fallback DEFAULT_SLA_MINUTES)', async () => {
      const prisma = createPrismaMock();
      prisma.__tenants.set(TENANT_A, { id: TENANT_A, plan: null });
      const svc = new SupportService(prisma as never);

      const before = Date.now();
      await svc.createByTenant(
        { id: 'u', tenantId: TENANT_A },
        { title: 'Question', description: 'Comment paramétrer X ?', priority: 'NORMAL' },
      );

      const tk = [...prisma.__tickets.values()][0];
      expect(tk.slaDueAt).toBeInstanceOf(Date);
      const slaMs = (tk.slaDueAt as Date).getTime() - before;
      // NORMAL = 24h = 86_400_000 ms (±5s tolerance)
      expect(slaMs).toBeGreaterThan(86_400_000 - 5000);
      expect(slaMs).toBeLessThan(86_400_000 + 5000);
    });
  });

  describe('SLA capping par plan', () => {
    it('cappe CRITICAL à HIGH si plan.sla.maxPriority = HIGH', async () => {
      const prisma = createPrismaMock();
      prisma.__tenants.set(TENANT_A, {
        id: TENANT_A,
        plan: { sla: { maxPriority: 'HIGH' } },
      });
      const svc = new SupportService(prisma as never);

      await svc.createByTenant(
        { id: 'u', tenantId: TENANT_A },
        { title: 't', description: 'A bug with 10 chars', priority: 'CRITICAL' },
      );

      const tk = [...prisma.__tickets.values()][0];
      expect(tk.priority).toBe('HIGH');
    });

    it('respecte la priorité demandée si elle est sous le cap', async () => {
      const prisma = createPrismaMock();
      prisma.__tenants.set(TENANT_A, {
        id: TENANT_A,
        plan: { sla: { maxPriority: 'CRITICAL' } },
      });
      const svc = new SupportService(prisma as never);

      await svc.createByTenant(
        { id: 'u', tenantId: TENANT_A },
        { title: 't', description: 'aaaaaaaaaa', priority: 'NORMAL' },
      );

      const tk = [...prisma.__tickets.values()][0];
      expect(tk.priority).toBe('NORMAL');
    });

    it('plan.sla.firstResponseMinByPriority override DEFAULT_SLA_MINUTES', async () => {
      const prisma = createPrismaMock();
      prisma.__tenants.set(TENANT_A, {
        id: TENANT_A,
        plan: { sla: { firstResponseMinByPriority: { NORMAL: 15 } } }, // 15 min
      });
      const svc = new SupportService(prisma as never);

      const before = Date.now();
      await svc.createByTenant(
        { id: 'u', tenantId: TENANT_A },
        { title: 't', description: 'aaaaaaaaaa', priority: 'NORMAL' },
      );

      const tk = [...prisma.__tickets.values()][0];
      const slaMs = (tk.slaDueAt as Date).getTime() - before;
      // 15 min = 900_000 ms (±5s)
      expect(slaMs).toBeGreaterThan(900_000 - 5000);
      expect(slaMs).toBeLessThan(900_000 + 5000);
    });
  });

  describe('findByTenant — tenant isolation', () => {
    it('rejette si ticket appartient à un autre tenant', async () => {
      const prisma = createPrismaMock();
      prisma.__tickets.set('tk-1', { id: 'tk-1', tenantId: TENANT_B, status: 'OPEN' });
      const svc = new SupportService(prisma as never);

      await expect(svc.findByTenant(TENANT_A, 'tk-1')).rejects.toThrow(ForbiddenException);
    });

    it('retourne le ticket si le tenantId matche', async () => {
      const prisma = createPrismaMock();
      prisma.__tickets.set('tk-1', { id: 'tk-1', tenantId: TENANT_A, status: 'OPEN' });
      const svc = new SupportService(prisma as never);

      const tk = await svc.findByTenant(TENANT_A, 'tk-1');
      expect(tk).toBeDefined();
      expect(tk.tenantId).toBe(TENANT_A);
    });

    it('404 si le ticket n\'existe pas', async () => {
      const prisma = createPrismaMock();
      const svc = new SupportService(prisma as never);
      await expect(svc.findByTenant(TENANT_A, 'ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('addMessageByTenant', () => {
    it('rejette si le ticket est RESOLVED/CLOSED', async () => {
      const prisma = createPrismaMock();
      prisma.__tickets.set('tk-1', { id: 'tk-1', tenantId: TENANT_A, status: 'CLOSED' });
      const svc = new SupportService(prisma as never);

      await expect(svc.addMessageByTenant(
        { id: 'u', tenantId: TENANT_A },
        'tk-1',
        { body: 'ping' },
      )).rejects.toThrow(BadRequestException);
    });

    it('WAITING_CUSTOMER → IN_PROGRESS quand le tenant répond', async () => {
      const prisma = createPrismaMock();
      prisma.__tickets.set('tk-1', { id: 'tk-1', tenantId: TENANT_A, status: 'WAITING_CUSTOMER' });
      const svc = new SupportService(prisma as never);

      await svc.addMessageByTenant(
        { id: 'u', tenantId: TENANT_A },
        'tk-1',
        { body: 'La solution proposée a marché partiellement' },
      );

      expect(prisma.__tickets.get('tk-1')!.status).toBe('IN_PROGRESS');
    });
  });

  describe('addMessageByPlatform', () => {
    it('rejette un actor non-plateforme', async () => {
      const prisma = createPrismaMock();
      prisma.__tickets.set('tk-1', { id: 'tk-1', tenantId: TENANT_A, status: 'OPEN' });
      const svc = new SupportService(prisma as never);

      await expect(svc.addMessageByPlatform(
        { id: 'u', tenantId: TENANT_A },
        'tk-1',
        { body: 'hello' },
      )).rejects.toThrow(ForbiddenException);
    });

    it('trace firstResponseAt au 1er message externe', async () => {
      const prisma = createPrismaMock();
      prisma.__tickets.set('tk-1', { id: 'tk-1', tenantId: TENANT_A, status: 'OPEN', firstResponseAt: null });
      const svc = new SupportService(prisma as never);

      await svc.addMessageByPlatform(
        { id: 'sa', tenantId: PLATFORM_TENANT_ID },
        'tk-1',
        { body: 'Nous investiguons', isInternal: false },
      );

      const tk = prisma.__tickets.get('tk-1')!;
      expect(tk.firstResponseAt).toBeInstanceOf(Date);
      expect(tk.status).toBe('IN_PROGRESS');
    });

    it('note interne ne change PAS le status ni firstResponseAt', async () => {
      const prisma = createPrismaMock();
      prisma.__tickets.set('tk-1', { id: 'tk-1', tenantId: TENANT_A, status: 'OPEN', firstResponseAt: null });
      const svc = new SupportService(prisma as never);

      await svc.addMessageByPlatform(
        { id: 'sa', tenantId: PLATFORM_TENANT_ID },
        'tk-1',
        { body: 'Note interne : escalader L2', isInternal: true },
      );

      const tk = prisma.__tickets.get('tk-1')!;
      expect(tk.firstResponseAt).toBeNull();
      expect(tk.status).toBe('OPEN');
    });

    it('IN_PROGRESS → WAITING_CUSTOMER quand plateforme répond', async () => {
      const prisma = createPrismaMock();
      prisma.__tickets.set('tk-1', { id: 'tk-1', tenantId: TENANT_A, status: 'IN_PROGRESS', firstResponseAt: new Date() });
      const svc = new SupportService(prisma as never);

      await svc.addMessageByPlatform(
        { id: 'sa', tenantId: PLATFORM_TENANT_ID },
        'tk-1',
        { body: 'Pouvez-vous tester ceci ?', isInternal: false },
      );

      expect(prisma.__tickets.get('tk-1')!.status).toBe('WAITING_CUSTOMER');
    });
  });

  describe('updateByPlatform', () => {
    it('recalcule slaDueAt au changement de priorité si pas encore de first response', async () => {
      const prisma = createPrismaMock();
      prisma.__tickets.set('tk-1', {
        id: 'tk-1', tenantId: TENANT_A, status: 'OPEN',
        priority: 'NORMAL', firstResponseAt: null, createdAt: new Date(),
      });
      prisma.__tenants.set(TENANT_A, { id: TENANT_A, plan: null });
      const svc = new SupportService(prisma as never);

      await svc.updateByPlatform('tk-1', { priority: 'CRITICAL' });

      const tk = prisma.__tickets.get('tk-1')!;
      expect(tk.priority).toBe('CRITICAL');
      expect(tk.slaDueAt).toBeInstanceOf(Date);
    });

    it('status = RESOLVED pose resolvedAt', async () => {
      const prisma = createPrismaMock();
      prisma.__tickets.set('tk-1', { id: 'tk-1', tenantId: TENANT_A, status: 'IN_PROGRESS' });
      const svc = new SupportService(prisma as never);

      await svc.updateByPlatform('tk-1', { status: 'RESOLVED' });
      expect(prisma.__tickets.get('tk-1')!.resolvedAt).toBeInstanceOf(Date);
    });
  });
});
