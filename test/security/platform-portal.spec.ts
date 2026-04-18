/**
 * Security Test — Portail plateforme SaaS
 *
 * Vérifie les invariants de sécurité des nouveaux modules :
 *
 *   [S1] Tenant isolation sur support tickets
 *        - Un tenantA ne peut PAS lire/écrire les tickets de tenantB
 *        - findByTenant retourne ForbiddenException sur tenantId mismatch
 *
 *   [S2] Permissions plateforme
 *        - addMessageByPlatform rejette un actor du tenant client (403)
 *        - createByTenant rejette un actor du tenant plateforme (403)
 *
 *   [S3] SLA capping par plan
 *        - Un tenant sans plan ne peut pas créer de ticket CRITICAL
 *          (capped via plan.sla.maxPriority si défini, sinon fallback DEFAULT)
 *
 *   [S4] PlatformConfig input validation
 *        - Valeurs hors bornes rejetées (BadRequestException)
 *        - Clés inconnues rejetées (NotFoundException) — pas de magic string
 *        - Types invalides rejetés (string non-coercible → null → 400)
 *
 *   [S5] Plan soft-delete safety
 *        - Un plan avec tenants attachés n'est PAS hard-deleted (préserve
 *          l'intégrité référentielle des souscriptions)
 *
 *   [S6] Billing : pas d'abonnement sur le tenant plateforme
 *        - createSubscription rejette PLATFORM_TENANT_ID (400)
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SupportService }         from '../../src/modules/support/support.service';
import { PlatformConfigService }  from '../../src/modules/platform-config/platform-config.service';
import { PlatformPlansService }   from '../../src/modules/platform-plans/platform-plans.service';
import { PlatformBillingService } from '../../src/modules/platform-billing/platform-billing.service';

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

// ─── Mini mocks ciblés ───────────────────────────────────────────────────────

function prismaConfigMock() {
  const rows = new Map<string, { key: string; value: unknown; updatedBy: string | null }>();
  return {
    platformConfig: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null),
      findMany:   jest.fn(async () => Array.from(rows.values())),
      upsert:     jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    __rows: rows,
  };
}

function prismaSupportMock() {
  const tickets = new Map<string, Record<string, unknown>>();
  const tenants = new Map<string, Record<string, unknown>>();
  return {
    supportTicket: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const tk = tickets.get(where.id);
        return tk ? { ...tk, messages: [] } : null;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const t = { id: `tk-${tickets.size + 1}`, ...data };
        tickets.set(String(t.id), t);
        return t;
      }),
      update: jest.fn(async () => ({})),
    },
    supportMessage: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', ...data })),
    },
    tenant: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => tenants.get(where.id) ?? null),
    },
    __tickets: tickets,
    __tenants: tenants,
  };
}

function prismaPlansMock() {
  return {
    plan: {
      findUnique: jest.fn(),
      update:     jest.fn().mockResolvedValue({}),
      delete:     jest.fn().mockResolvedValue({}),
    },
    planModule: { deleteMany: jest.fn().mockResolvedValue({}) },
  };
}

function prismaBillingMock() {
  return {
    plan: { findUnique: jest.fn() },
    platformSubscription: { findUnique: jest.fn(), upsert: jest.fn() },
    tenant: { update: jest.fn() },
  };
}

const silentConfig = { getNumber: jest.fn(async () => { throw new Error('fallback'); }) };

// ─────────────────────────────────────────────────────────────────────────────

describe('[SECURITY] Portail plateforme SaaS', () => {

  // ─── [S1] Tenant isolation sur support tickets ─────────────────────────────
  describe('[S1] Support — tenant isolation', () => {
    it('tenantA ne peut pas lire un ticket de tenantB', async () => {
      const prisma = prismaSupportMock();
      prisma.__tickets.set('tk-secret', { id: 'tk-secret', tenantId: TENANT_B, status: 'OPEN' });
      const svc = new SupportService(prisma as never);

      await expect(svc.findByTenant(TENANT_A, 'tk-secret'))
        .rejects.toThrow(ForbiddenException);
    });

    it('tenantA ne peut pas répondre à un ticket de tenantB (blocage find avant message)', async () => {
      const prisma = prismaSupportMock();
      prisma.__tickets.set('tk-foreign', { id: 'tk-foreign', tenantId: TENANT_B, status: 'OPEN' });
      const svc = new SupportService(prisma as never);

      await expect(svc.addMessageByTenant(
        { id: 'attacker', tenantId: TENANT_A },
        'tk-foreign',
        { body: 'Tentative de cross-tenant write' },
      )).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── [S2] Frontière permission plateforme / tenant ─────────────────────────
  describe('[S2] Permissions plateforme', () => {
    it('un user tenant client ne peut pas poster un message en tant que PLATFORM', async () => {
      const prisma = prismaSupportMock();
      prisma.__tickets.set('tk-1', { id: 'tk-1', tenantId: TENANT_A, status: 'OPEN' });
      const svc = new SupportService(prisma as never);

      await expect(svc.addMessageByPlatform(
        { id: 'tenant-user', tenantId: TENANT_A }, // PAS plateforme
        'tk-1',
        { body: 'Usurpation plateforme' },
      )).rejects.toThrow(ForbiddenException);
    });

    it('le staff plateforme ne peut pas créer de ticket "client" (endpoint tenant)', async () => {
      const prisma = prismaSupportMock();
      const svc = new SupportService(prisma as never);

      await expect(svc.createByTenant(
        { id: 'sa', tenantId: PLATFORM_TENANT_ID },
        { title: 'Tentative', description: 'Tentative de création côté plateforme' },
      )).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── [S3] SLA capping par plan ─────────────────────────────────────────────
  describe('[S3] SLA capping par plan', () => {
    it('une priorité CRITICAL demandée est cappée par plan.sla.maxPriority', async () => {
      const prisma = prismaSupportMock();
      prisma.__tenants.set(TENANT_A, {
        id: TENANT_A,
        plan: { sla: { maxPriority: 'NORMAL' } }, // plan bas de gamme
      });
      const svc = new SupportService(prisma as never);

      await svc.createByTenant(
        { id: 'u', tenantId: TENANT_A },
        { title: 'Urgent', description: 'En théorie critique', priority: 'CRITICAL' },
      );

      const tk = [...prisma.__tickets.values()][0];
      expect(tk.priority).toBe('NORMAL');
    });
  });

  // ─── [S4] PlatformConfig input validation ──────────────────────────────────
  describe('[S4] PlatformConfig validation', () => {
    it('rejette une valeur hors bornes (riskThreshold > 100)', async () => {
      const svc = new PlatformConfigService(prismaConfigMock() as never);
      await expect(svc.set('health.riskThreshold', 999, 'attacker'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejette riskThreshold négatif', async () => {
      const svc = new PlatformConfigService(prismaConfigMock() as never);
      await expect(svc.set('health.riskThreshold', -5, 'attacker'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejette une clé inconnue (pas de magic string accepté)', async () => {
      const svc = new PlatformConfigService(prismaConfigMock() as never);
      await expect(svc.set('sql.injection.attempt', '; DROP TABLE users;--', 'attacker'))
        .rejects.toThrow(NotFoundException);
    });

    it('rejette un type invalide (objet → pas de coercion possible)', async () => {
      const svc = new PlatformConfigService(prismaConfigMock() as never);
      await expect(svc.set('health.riskThreshold', { nested: 'payload' }, 'attacker'))
        .rejects.toThrow(BadRequestException);
    });

    it('setBatch avec une entrée invalide → rollback intégral (pas d\'écriture partielle)', async () => {
      const prisma = prismaConfigMock();
      const svc = new PlatformConfigService(prisma as never);

      await expect(svc.setBatch(
        [
          { key: 'health.riskThreshold',        value: 75 },   // valide
          { key: 'health.thresholds.incidents', value: 99999 }, // hors bornes
        ],
        'actor',
      )).rejects.toThrow();

      // Aucune des deux écritures ne doit avoir eu lieu
      expect(prisma.platformConfig.upsert).not.toHaveBeenCalled();
    });
  });

  // ─── [S5] Plan soft-delete safety ──────────────────────────────────────────
  describe('[S5] Plan soft-delete — intégrité référentielle', () => {
    it('plan avec tenants actifs → désactivation (jamais DELETE)', async () => {
      const prisma = prismaPlansMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({
        id: 'plan-core', _count: { tenants: 42, subscriptions: 42 },
      });
      const svc = new PlatformPlansService(prisma as never);

      await svc.remove('plan-core');

      expect(prisma.plan.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { isActive: false, isPublic: false },
      }));
      expect(prisma.plan.delete).not.toHaveBeenCalled();
    });

    it('plan avec subscriptions historiques → désactivation (préserve audit)', async () => {
      const prisma = prismaPlansMock();
      prisma.plan.findUnique = jest.fn().mockResolvedValue({
        id: 'plan-old', _count: { tenants: 0, subscriptions: 5 },
      });
      const svc = new PlatformPlansService(prisma as never);

      await svc.remove('plan-old');
      expect(prisma.plan.delete).not.toHaveBeenCalled();
    });
  });

  // ─── [S6] Billing — pas d'abonnement sur le tenant plateforme ──────────────
  describe('[S6] Billing — tenant plateforme protégé', () => {
    it('createSubscription rejette PLATFORM_TENANT_ID', async () => {
      const prisma = prismaBillingMock();
      const svc = new PlatformBillingService(prisma as never, silentConfig as never);

      await expect(svc.createSubscription({
        tenantId: PLATFORM_TENANT_ID,
        planId:   'any-plan',
      })).rejects.toThrow(BadRequestException);

      // Le plan n'est même pas chargé — garde en amont
      expect(prisma.plan.findUnique).not.toHaveBeenCalled();
    });
  });
});
