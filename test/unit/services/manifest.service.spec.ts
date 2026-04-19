/**
 * ManifestService — Tests unitaires (workflow-aware)
 *
 * Vérifie que le service respecte le blueprint `manifest-standard` :
 *   - generate() crée un Manifest DRAFT puis transitionne vers SUBMITTED
 *   - sign() exige SUBMITTED, transitionne vers SIGNED, génère le PDF figé
 *   - findByTrip() lit la table Manifest
 *   - getDownloadUrl() renvoie l'URL du PDF figé si présent
 *
 * Mocks : PrismaService, WorkflowEngine, DocumentsService, IStorageService, IEventBus
 */

import { NotFoundException, BadRequestException } from '@nestjs/common';

// Isoler ManifestService de la chaîne DocumentsService → @pdfme/generator
// (ESM non transformé par jest en mode unit). On n'utilise que la forme type.
jest.mock('@modules/documents/documents.service', () => ({
  DocumentsService: class { printManifest() { return undefined; } },
}));

import { ManifestService } from '@modules/manifest/manifest.service';
import { PrismaService } from '@infra/database/prisma.service';
import { WorkflowEngine } from '@core/workflow/workflow.engine';
import { DocumentsService } from '@modules/documents/documents.service';
import { IStorageService, DocumentType } from '@infra/storage/interfaces/storage.interface';
import { IEventBus } from '@infra/eventbus/interfaces/eventbus.interface';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = 'tenant-manifest-001';
const TRIP   = 'trip-001';
const ACTOR  = { id: 'agent-01', tenantId: TENANT, roleId: 'role-agent', agencyId: 'agency-01', roleName: 'Agent' };

const TRIP_FIXTURE = {
  id:        TRIP,
  tenantId:  TENANT,
  travelers: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
  shipments: [
    { parcels: [{ id: 'p1' }, { id: 'p2' }] },
    { parcels: [{ id: 'p3' }] },
  ],
};

function makeManifestRow(overrides: Partial<{
  id: string; status: string; kind: string; version: number;
  signedPdfStorageKey: string | null; signedAt: Date | null;
}> = {}) {
  return {
    id:                  overrides.id ?? 'manifest-001',
    tenantId:            TENANT,
    tripId:              TRIP,
    kind:                overrides.kind ?? 'ALL',
    status:              overrides.status ?? 'DRAFT',
    version:             overrides.version ?? 1,
    storageKey:          `${TENANT}/manifests/${TRIP}/all/111.pdf`,
    signedPdfStorageKey: overrides.signedPdfStorageKey ?? null,
    passengerCount:      3,
    parcelCount:         3,
    signatureSvg:        null,
    signedAt:            overrides.signedAt ?? null,
    signedById:          null,
    generatedAt:         new Date(),
    generatedById:       ACTOR.id,
    createdAt:           new Date(),
    updatedAt:           new Date(),
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    trip:     { findFirst: jest.fn().mockResolvedValue(TRIP_FIXTURE) },
    manifest: {
      findFirst:         jest.fn().mockResolvedValue(null),
      findFirstOrThrow:  jest.fn(),
      create:            jest.fn(),
      update:            jest.fn(),
      findMany:          jest.fn().mockResolvedValue([]),
    },
  } as unknown as jest.Mocked<PrismaService> & Record<string, any>;
}

/**
 * Stubs le WorkflowEngine — simule l'exécution de la transition en appelant
 * la persist callback et retourne l'entité mise à jour avec le toState choisi
 * selon l'action. Permet de vérifier que le service appelle l'engine avec
 * les bons paramètres sans démarrer l'infra complète.
 */
function makeWorkflow(transitionMap: Record<string, string> = {
  submit:  'SUBMITTED',
  sign:    'SIGNED',
  revise:  'DRAFT',
  reject:  'REJECTED',
  archive: 'ARCHIVED',
}) {
  return {
    transition: jest.fn().mockImplementation(async (entity: any, input: any, config: any) => {
      const toState = transitionMap[input.action] ?? entity.status;
      // On n'invoque PAS le persist callback (prisma mock tx absent). On se contente
      // de retourner l'entité avec le nouvel état pour que le service récupère la suite.
      return { entity: { ...entity, status: toState, version: entity.version + 1 }, toState, fromState: entity.status };
    }),
  } as unknown as jest.Mocked<WorkflowEngine>;
}

function makeDocs() {
  return {
    printManifest: jest.fn().mockResolvedValue({
      storageKey:  `${TENANT}/documents/manifests/${TRIP}/all/222.pdf`,
      downloadUrl: 'https://minio.local/signed-pdf-url',
    }),
  } as unknown as jest.Mocked<DocumentsService>;
}

function makeStorage() {
  return {
    getUploadUrl:   jest.fn().mockResolvedValue('https://minio.local/upload-url'),
    getDownloadUrl: jest.fn().mockResolvedValue('https://minio.local/download-url'),
    deleteObject:   jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IStorageService>;
}

function makeEventBus() {
  return { publish: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<IEventBus>;
}

function buildService(opts: {
  prisma?:   ReturnType<typeof makePrisma>;
  workflow?: ReturnType<typeof makeWorkflow>;
  docs?:     ReturnType<typeof makeDocs>;
  storage?:  ReturnType<typeof makeStorage>;
  eventBus?: ReturnType<typeof makeEventBus>;
} = {}) {
  const prisma   = opts.prisma   ?? makePrisma();
  const workflow = opts.workflow ?? makeWorkflow();
  const docs     = opts.docs     ?? makeDocs();
  const storage  = opts.storage  ?? makeStorage();
  const eventBus = opts.eventBus ?? makeEventBus();
  return {
    service: new ManifestService(prisma, workflow, docs, storage, eventBus),
    prisma, workflow, docs, storage, eventBus,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ManifestService (workflow-aligned)', () => {

  // ── generate() ─────────────────────────────────────────────────────────────

  describe('generate()', () => {
    it('lève NotFoundException si le trip n\'existe pas', async () => {
      const prisma = makePrisma();
      prisma.trip.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma });
      await expect(service.generate(TENANT, 'absent', ACTOR as any)).rejects.toThrow(NotFoundException);
    });

    it('crée un Manifest DRAFT puis appelle workflow.transition(submit)', async () => {
      const prisma = makePrisma();
      const createdRow   = makeManifestRow({ status: 'DRAFT', version: 1 });
      const submittedRow = makeManifestRow({ status: 'SUBMITTED', version: 2 });
      prisma.manifest.findFirst        = jest.fn().mockResolvedValue(null);
      prisma.manifest.create           = jest.fn().mockResolvedValue(createdRow);
      prisma.manifest.findFirstOrThrow = jest.fn().mockResolvedValue(submittedRow);

      const { service, workflow } = buildService({ prisma });
      const result = await service.generate(TENANT, TRIP, ACTOR as any);

      expect(prisma.manifest.create).toHaveBeenCalled();
      expect(workflow.transition).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'DRAFT' }),
        expect.objectContaining({ action: 'submit', actor: ACTOR }),
        expect.objectContaining({ aggregateType: 'Manifest' }),
      );
      expect(result.status).toBe('SUBMITTED');
    });

    it('est idempotent — un second appel sur SUBMITTED ne re-transitionne pas', async () => {
      const prisma = makePrisma();
      const submittedRow = makeManifestRow({ status: 'SUBMITTED', version: 2 });
      prisma.manifest.findFirst = jest.fn().mockResolvedValue(submittedRow);

      const { service, workflow } = buildService({ prisma });
      const result = await service.generate(TENANT, TRIP, ACTOR as any);

      expect(workflow.transition).not.toHaveBeenCalled();
      expect(result.status).toBe('SUBMITTED');
    });

    it('sur REJECTED : revise → DRAFT → submit → SUBMITTED', async () => {
      const prisma = makePrisma();
      const rejected = makeManifestRow({ status: 'REJECTED', version: 3 });
      const draft    = makeManifestRow({ status: 'DRAFT',     version: 4 });
      const submitted= makeManifestRow({ status: 'SUBMITTED', version: 5 });
      prisma.manifest.findFirst = jest.fn().mockResolvedValue(rejected);
      prisma.manifest.update    = jest.fn().mockResolvedValue(rejected);
      prisma.manifest.findFirstOrThrow = jest.fn()
        .mockResolvedValueOnce(draft)      // après revise
        .mockResolvedValueOnce(submitted); // après submit

      const { service, workflow } = buildService({ prisma });
      const result = await service.generate(TENANT, TRIP, ACTOR as any);

      const actions = workflow.transition.mock.calls.map(c => (c[1] as any).action);
      expect(actions).toEqual(['revise', 'submit']);
      expect(result.status).toBe('SUBMITTED');
    });

    it('calcule passengerCount et parcelCount depuis le trip', async () => {
      const prisma = makePrisma();
      prisma.manifest.findFirst = jest.fn().mockResolvedValue(null);
      prisma.manifest.create = jest.fn().mockImplementation(async (args: any) => ({
        ...makeManifestRow({ status: 'DRAFT' }),
        passengerCount: args.data.passengerCount,
        parcelCount:    args.data.parcelCount,
      }));
      prisma.manifest.findFirstOrThrow = jest.fn().mockResolvedValue(makeManifestRow({ status: 'SUBMITTED' }));

      const { service } = buildService({ prisma });
      await service.generate(TENANT, TRIP, ACTOR as any);

      expect(prisma.manifest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passengerCount: 3, parcelCount: 3 }),
        }),
      );
    });
  });

  // ── sign() ─────────────────────────────────────────────────────────────────

  describe('sign()', () => {
    it('lève NotFoundException si le manifeste n\'existe pas', async () => {
      const prisma = makePrisma();
      prisma.manifest.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma });
      await expect(service.sign(TENANT, 'absent', ACTOR as any)).rejects.toThrow(NotFoundException);
    });

    it('lève BadRequestException si statut != SUBMITTED', async () => {
      const prisma = makePrisma();
      prisma.manifest.findFirst = jest.fn().mockResolvedValue(makeManifestRow({ status: 'DRAFT' }));
      const { service } = buildService({ prisma });
      await expect(service.sign(TENANT, 'manifest-001', ACTOR as any)).rejects.toThrow(BadRequestException);
    });

    it('transitionne SUBMITTED → SIGNED puis génère le PDF figé', async () => {
      const prisma = makePrisma();
      const submitted = makeManifestRow({ status: 'SUBMITTED', version: 2 });
      const signed    = makeManifestRow({ status: 'SIGNED',    version: 3 });
      const withPdf   = makeManifestRow({ status: 'SIGNED',    version: 3, signedPdfStorageKey: 'key/to/pdf' });

      prisma.manifest.findFirst = jest.fn().mockResolvedValue(submitted);
      prisma.manifest.findFirstOrThrow = jest.fn().mockResolvedValue(signed);
      prisma.manifest.update = jest.fn()
        .mockResolvedValueOnce({ ...signed, signedAt: new Date(), signedById: ACTOR.id })
        .mockResolvedValueOnce(withPdf);

      const { service, workflow, docs } = buildService({ prisma });
      const result = await service.sign(TENANT, 'manifest-001', ACTOR as any);

      expect(workflow.transition).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SUBMITTED' }),
        expect.objectContaining({ action: 'sign', actor: ACTOR }),
        expect.objectContaining({ aggregateType: 'Manifest' }),
      );
      expect(docs.printManifest).toHaveBeenCalledWith(TENANT, TRIP, ACTOR, undefined, 'ALL');
      expect(result.status).toBe('SIGNED');
      expect(result.signedPdfStorageKey).toBe('key/to/pdf');
    });

    it('idempotent sur manifeste déjà SIGNED : ne retransitionne pas', async () => {
      const prisma = makePrisma();
      const signed = makeManifestRow({ status: 'SIGNED', version: 3, signedPdfStorageKey: 'existing/key.pdf' });
      prisma.manifest.findFirst = jest.fn().mockResolvedValue(signed);

      const { service, workflow } = buildService({ prisma });
      const result = await service.sign(TENANT, 'manifest-001', ACTOR as any);

      expect(workflow.transition).not.toHaveBeenCalled();
      expect(result.status).toBe('SIGNED');
    });

    it('borne la signatureSvg à 256 KB — au-delà elle est droppée (null)', async () => {
      const prisma = makePrisma();
      const submitted = makeManifestRow({ status: 'SUBMITTED', version: 2 });
      const signed    = makeManifestRow({ status: 'SIGNED',    version: 3 });
      prisma.manifest.findFirst        = jest.fn().mockResolvedValue(submitted);
      prisma.manifest.findFirstOrThrow = jest.fn().mockResolvedValue(signed);
      prisma.manifest.update = jest.fn().mockResolvedValue(signed);

      const { service } = buildService({ prisma });
      const oversized = 'a'.repeat(256 * 1024 + 1);
      await service.sign(TENANT, 'manifest-001', ACTOR as any, oversized);

      // Le premier update() pose les champs signer + signatureSvg — doit être null
      const firstUpdateCall = (prisma.manifest.update as jest.Mock).mock.calls[0][0];
      expect(firstUpdateCall.data.signatureSvg).toBeNull();
    });
  });

  // ── findByTrip() ───────────────────────────────────────────────────────────

  describe('findByTrip()', () => {
    it('retourne les manifestes du trajet trié par kind', async () => {
      const prisma = makePrisma();
      const rows = [
        makeManifestRow({ kind: 'PASSENGERS', id: 'm-pax' }),
        makeManifestRow({ kind: 'PARCELS',    id: 'm-par' }),
      ];
      prisma.manifest.findMany = jest.fn().mockResolvedValue(rows);

      const { service } = buildService({ prisma });
      const result = await service.findByTrip(TENANT, TRIP);

      expect(prisma.manifest.findMany).toHaveBeenCalledWith({
        where:   { tenantId: TENANT, tripId: TRIP },
        orderBy: { kind: 'asc' },
      });
      expect(result.map(m => m.id)).toEqual(['m-pax', 'm-par']);
    });
  });

  // ── getDownloadUrl() ───────────────────────────────────────────────────────

  describe('getDownloadUrl()', () => {
    it('lève NotFoundException si le manifeste n\'existe pas', async () => {
      const prisma = makePrisma();
      prisma.manifest.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma });
      await expect(service.getDownloadUrl(TENANT, 'absent')).rejects.toThrow(NotFoundException);
    });

    it('lève BadRequestException si signedPdfStorageKey absent', async () => {
      const prisma = makePrisma();
      prisma.manifest.findFirst = jest.fn().mockResolvedValue(
        makeManifestRow({ status: 'SIGNED', signedPdfStorageKey: null }),
      );
      const { service } = buildService({ prisma });
      await expect(service.getDownloadUrl(TENANT, 'manifest-001')).rejects.toThrow(BadRequestException);
    });

    it('délègue à IStorageService.getDownloadUrl avec la clé du PDF figé', async () => {
      const prisma = makePrisma();
      prisma.manifest.findFirst = jest.fn().mockResolvedValue(
        makeManifestRow({ status: 'SIGNED', signedPdfStorageKey: 'key/to/pdf' }),
      );
      const { service, storage } = buildService({ prisma });
      const url = await service.getDownloadUrl(TENANT, 'manifest-001');
      expect(storage.getDownloadUrl).toHaveBeenCalledWith(TENANT, 'key/to/pdf', DocumentType.MAINTENANCE_DOC);
      expect(url).toBe('https://minio.local/download-url');
    });
  });
});
