/**
 * OnboardingService — Tests unitaires
 *
 * Ce qui est testé :
 *   - Agence par défaut "Agence principale" créée AVANT l'admin en fr (défaut)
 *   - Agence par défaut "Main Agency" en en
 *   - Admin user crée avec agencyId = id de l'agence par défaut
 *   - ConflictException si slug déjà pris
 *   - Clé HMAC provisionnée dans Vault après la transaction
 *
 * Stratégie : mock du module iam.seed (seedTenantRoles + ensureDefaultAgency)
 * + mock PrismaService.transact exécutant le callback avec un tx mocké.
 */

jest.mock('../../../prisma/seeds/iam.seed', () => ({
  seedTenantRoles:                 jest.fn().mockResolvedValue(new Map([['TENANT_ADMIN', 'role-admin']])),
  ensureDefaultAgency:             jest.fn().mockResolvedValue('agency-default-id'),
  DEFAULT_AGENCY_NAME:             { fr: 'Agence principale', en: 'Main Agency' },
  DEFAULT_WORKFLOW_CONFIGS:        [],
  installSystemBlueprintsForTenant: jest.fn().mockResolvedValue(0),
  // Seed documents véhicule par défaut — ajouté en même temps qu'Assurance/Carte grise.
  seedDefaultVehicleDocumentTypes:  jest.fn().mockResolvedValue(5),
}));

// Sprint 5 : seed peak periods (mock pour isoler le test onboarding du catalogue réel).
jest.mock('../../../prisma/seeds/peak-periods.seed', () => ({
  seedPeakPeriodsForTenant: jest.fn().mockResolvedValue({ created: 4, skipped: 0 }),
}));

import { ConflictException } from '@nestjs/common';
import { OnboardingService } from '@modules/onboarding/onboarding.service';
import { PrismaService } from '@infra/database/prisma.service';
import type { ISecretService } from '@infra/secret/interfaces/secret.interface';
import {
  seedTenantRoles,
  ensureDefaultAgency,
} from '../../../prisma/seeds/iam.seed';

const TENANT_ID = 'tenant-onb-001';

function makeTx(userCreateSpy?: jest.Mock) {
  return {
    tenant: {
      create:     jest.fn().mockResolvedValue({ id: TENANT_ID, slug: 'acme', name: 'Acme' }),
      update:     jest.fn().mockResolvedValue({ id: TENANT_ID }),
      // Sprint 5 : seedPricingDefaults lit le country du tenant pour seed peak periods.
      findUnique: jest.fn().mockResolvedValue({ country: 'CG' }),
    },
    user: {
      create: userCreateSpy ?? jest.fn().mockResolvedValue({ id: 'admin-id', email: 'a@acme.test' }),
    },
    workflowConfig:  { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    installedModule: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      // Sprint 5 : upsert YIELD_ENGINE dans seedPricingDefaults.
      upsert:     jest.fn().mockResolvedValue({ id: 'im-x' }),
    },
    documentTemplate: {
      findMany:  jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create:    jest.fn().mockResolvedValue({ id: 'tpl-x' }),
    },
    // Seed pricing defaults (S1) — upserts idempotents.
    tenantBusinessConfig: { upsert: jest.fn().mockResolvedValue({ id: 'bc-x' }) },
    tenantTax:            { upsert: jest.fn().mockResolvedValue({ id: 'tax-x' }) },
    tenantFareClass:      { upsert: jest.fn().mockResolvedValue({ id: 'fc-x' }) },
    // CMS seed (Phase 2026-04 — pages publiques about/fleet/contact + post bienvenue)
    tenantPortalConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
      create:     jest.fn().mockResolvedValue({ id: 'tpc-x' }),
    },
    tenantPage: {
      upsert: jest.fn().mockResolvedValue({ id: 'page-x' }),
    },
    tenantPost: {
      findFirst: jest.fn().mockResolvedValue(null),
      create:    jest.fn().mockResolvedValue({ id: 'post-x' }),
    },
  };
}

function makePrisma(txOverride?: ReturnType<typeof makeTx>): jest.Mocked<PrismaService> {
  const tx = txOverride ?? makeTx();
  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    transact: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  } as unknown as jest.Mocked<PrismaService>;
}

function makeSecret(): jest.Mocked<ISecretService> {
  return {
    putSecret: jest.fn().mockResolvedValue(undefined),
    getSecret: jest.fn().mockResolvedValue('dummy'),
  } as unknown as jest.Mocked<ISecretService>;
}

/** Mock minimal PlatformConfigService pour les tests OnboardingService. */
function makePlatformConfig(): any {
  return {
    getString: jest.fn(async (key: string) => {
      if (key === 'tax.defaults.tvaCode')     return 'TVA';
      if (key === 'tax.defaults.tvaLabelKey') return 'tax.tva';
      return '';
    }),
    getNumber: jest.fn(async (key: string) => (key === 'tax.defaults.tvaRate' ? 0.189 : 0)),
    getBoolean: jest.fn(async (key: string) =>
      key === 'tax.defaults.tvaAppliedToRecommendation',
    ),
    getJson: jest.fn(async (key: string) =>
      key === 'pricing.defaults.fareClasses'
        ? [{ code: 'STANDARD', labelKey: 'fareClass.standard', multiplier: 1, sortOrder: 0 }]
        : [],
    ),
  };
}

const DTO_BASE = {
  name:       'Acme Transport',
  slug:       'acme',
  adminEmail: 'admin@acme.test',
  adminName:  'Admin Acme',
};

beforeEach(() => {
  (seedTenantRoles as jest.Mock).mockClear();
  (ensureDefaultAgency as jest.Mock).mockClear();
});

describe('OnboardingService.onboard — invariant agence par défaut', () => {
  it('crée l\'agence "Agence principale" en fr (défaut) AVANT l\'admin', async () => {
    const userCreate = jest.fn().mockResolvedValue({ id: 'admin-id', email: 'a@acme.test' });
    const tx = makeTx(userCreate);
    const prisma = makePrisma(tx);
    const secret = makeSecret();

    const svc = new OnboardingService(prisma, secret, makePlatformConfig());
    await svc.onboard(DTO_BASE);

    expect(ensureDefaultAgency).toHaveBeenCalledWith(tx, TENANT_ID, 'Agence principale');

    // L'agence est créée AVANT l'admin (ordre d'appel)
    const agencyOrder = (ensureDefaultAgency as jest.Mock).mock.invocationCallOrder[0];
    const userOrder   = userCreate.mock.invocationCallOrder[0];
    expect(agencyOrder).toBeLessThan(userOrder);

    // L'admin reçoit l'agencyId retourné par ensureDefaultAgency
    expect(userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_ID,
        roleId:   'role-admin',
        agencyId: 'agency-default-id',
      }),
    });
  });

  it('crée "Main Agency" quand language = "en"', async () => {
    const prisma = makePrisma();
    const secret = makeSecret();
    const svc = new OnboardingService(prisma, secret, makePlatformConfig());

    await svc.onboard({ ...DTO_BASE, language: 'en' });

    expect(ensureDefaultAgency).toHaveBeenCalledWith(
      expect.anything(), TENANT_ID, 'Main Agency',
    );
  });

  it('ConflictException si le slug existe déjà', async () => {
    const prisma = makePrisma();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'existing' });
    const svc = new OnboardingService(prisma, makeSecret(), makePlatformConfig());

    await expect(svc.onboard(DTO_BASE)).rejects.toBeInstanceOf(ConflictException);
    expect(seedTenantRoles).not.toHaveBeenCalled();
    expect(ensureDefaultAgency).not.toHaveBeenCalled();
  });

  it('provisionne la clé HMAC dans Vault après la transaction', async () => {
    const prisma = makePrisma();
    const secret = makeSecret();
    const svc = new OnboardingService(prisma, secret, makePlatformConfig());

    await svc.onboard(DTO_BASE);

    expect(secret.putSecret).toHaveBeenCalledWith(
      `tenants/${TENANT_ID}/hmac`,
      expect.objectContaining({ KEY: expect.any(String) }),
    );
  });
});
