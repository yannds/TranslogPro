/**
 * BriefingTemplateService — Tests unitaires.
 * Couvre : CRUD templates, upsertSection, upsertItem, toggleItem, duplicate,
 * validation kind/autoSource, gestion isDefault unique, scope tenant.
 */

import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BriefingTemplateService }                  from '@modules/crew-briefing/briefing-template.service';
import { PrismaService }                            from '@infra/database/prisma.service';

const TENANT_ID = 'tenant-1';

function makePrisma(overrides: Partial<Record<string, any>> = {}): PrismaService {
  const defaults: Record<string, any> = {
    briefingTemplate: {
      findMany:   jest.fn().mockResolvedValue([]),
      findFirst:  jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create:     jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 't1', ...data })),
      update:     jest.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    briefingSection: {
      findFirst:  jest.fn().mockResolvedValue(null),
      upsert:     jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 's1', ...create })),
      delete:     jest.fn().mockResolvedValue({ id: 's1' }),
      create:     jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 's-copy', ...data })),
    },
    briefingItem: {
      findFirst:  jest.fn().mockResolvedValue(null),
      upsert:     jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'i1', ...create })),
      update:     jest.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
      delete:     jest.fn().mockResolvedValue({ id: 'i1' }),
      create:     jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'i-copy', ...data })),
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb({
      briefingTemplate: defaults.briefingTemplate,
      briefingSection:  defaults.briefingSection,
      briefingItem:     defaults.briefingItem,
    })),
  };

  for (const key of Object.keys(overrides)) {
    defaults[key] = { ...defaults[key], ...overrides[key] };
  }

  return defaults as unknown as PrismaService;
}

describe('BriefingTemplateService', () => {
  let svc: BriefingTemplateService;

  beforeEach(() => jest.clearAllMocks());

  it('create() rejette si name déjà utilisé (tenant)', async () => {
    const prisma = makePrisma({
      briefingTemplate: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }) },
    });
    svc = new BriefingTemplateService(prisma);
    await expect(svc.create(TENANT_ID, { name: 'Urbain' })).rejects.toThrow(BadRequestException);
  });

  it('create() avec isDefault=true désactive l\'ancien défaut', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({ briefingTemplate: { updateMany } });
    svc = new BriefingTemplateService(prisma);
    await svc.create(TENANT_ID, { name: 'Longue distance', isDefault: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, isDefault: true },
      data:  { isDefault: false },
    });
  });

  it('update() lève NotFoundException si template absent du tenant', async () => {
    const prisma = makePrisma();
    svc = new BriefingTemplateService(prisma);
    await expect(svc.update(TENANT_ID, 'unknown', { name: 'X' }))
      .rejects.toThrow(NotFoundException);
  });

  it('upsertSection() force le code en UPPERCASE', async () => {
    const upsert = jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 's1', ...create }));
    const prisma = makePrisma({
      briefingTemplate: { findFirst: jest.fn().mockResolvedValue({ id: 't1' }) },
      briefingSection:  { upsert },
    });
    svc = new BriefingTemplateService(prisma);

    await svc.upsertSection(TENANT_ID, 't1', {
      code: 'safety_equipment',
      titleFr: 'Sécurité',
      titleEn: 'Safety',
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { templateId_code: { templateId: 't1', code: 'SAFETY_EQUIPMENT' } },
    }));
  });

  it('upsertItem() rejette kind invalide', async () => {
    const prisma = makePrisma({
      briefingSection: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
    });
    svc = new BriefingTemplateService(prisma);

    await expect(svc.upsertItem(TENANT_ID, 's1', {
      code: 'X',
      kind: 'INVALID' as any,
      labelFr: 'X',
      labelEn: 'X',
    })).rejects.toThrow(BadRequestException);
  });

  it('upsertItem() normalise le code et force autoSource=null hors kind=INFO', async () => {
    const upsert = jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'i1', ...create }));
    const prisma = makePrisma({
      briefingSection: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
      briefingItem:    { upsert },
    });
    svc = new BriefingTemplateService(prisma);

    await svc.upsertItem(TENANT_ID, 's1', {
      code: 'doc-carte grise!',
      kind: 'DOCUMENT',
      labelFr: 'Carte grise',
      labelEn: 'Registration',
      autoSource: 'WEATHER' as any,
    });

    const call = upsert.mock.calls[0][0];
    expect(call.where.sectionId_code.code).toBe('DOC_CARTE_GRISE_');
    expect(call.create.autoSource).toBeNull();
  });

  it('upsertItem() préserve autoSource pour kind=INFO', async () => {
    const upsert = jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'i1', ...create }));
    const prisma = makePrisma({
      briefingSection: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
      briefingItem:    { upsert },
    });
    svc = new BriefingTemplateService(prisma);

    await svc.upsertItem(TENANT_ID, 's1', {
      code: 'ROUTE_CONFIRMED',
      kind: 'INFO',
      labelFr: 'Itinéraire confirmé',
      labelEn: 'Route confirmed',
      autoSource: 'ROUTE_CONFIRMED',
    });

    expect(upsert.mock.calls[0][0].create.autoSource).toBe('ROUTE_CONFIRMED');
  });

  it('toggleItem() lève NotFoundException si item absent du tenant', async () => {
    const prisma = makePrisma();
    svc = new BriefingTemplateService(prisma);
    await expect(svc.toggleItem(TENANT_ID, 'unknown', false))
      .rejects.toThrow(NotFoundException);
  });

  it('duplicate() rejette si nom cible déjà utilisé', async () => {
    const prisma = makePrisma({
      briefingTemplate: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({
            id: 't1', tenantId: TENANT_ID, name: 'Standard',
            description: null,
            sections: [{
              id: 's1', code: 'DOC', titleFr: 'Doc', titleEn: 'Doc', order: 0, isActive: true,
              items: [{ id: 'i1', code: 'X', kind: 'CHECK', labelFr: 'x', labelEn: 'x', helpFr: null, helpEn: null, requiredQty: 1, isMandatory: true, isActive: true, order: 0, evidenceAllowed: false, autoSource: null }],
            }],
          })
          .mockResolvedValueOnce({ id: 'clash' }), // clash detection
      },
    });
    svc = new BriefingTemplateService(prisma);

    await expect(svc.duplicate(TENANT_ID, 't1', 'Standard'))
      .rejects.toThrow(BadRequestException);
  });

  it('getDefault() retourne null si aucun template actif par défaut', async () => {
    const prisma = makePrisma({
      briefingTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    svc = new BriefingTemplateService(prisma);
    const r = await svc.getDefault(TENANT_ID);
    expect(r).toBeNull();
  });
});
