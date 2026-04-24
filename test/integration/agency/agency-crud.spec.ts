/**
 * Agency CRUD — Tests d'intégration (DB réelle)
 *
 * Vérifie l'invariant "tout tenant ≥1 agence" :
 *   1. Création d'une 1ʳᵉ agence : OK
 *   2. Suppression → ConflictException (dernière agence)
 *   3. Création d'une 2ᵉ agence, suppression de la 1ʳᵉ : OK
 *   4. Les users rattachés à l'agence supprimée voient leur agencyId passer à null
 *   5. Station hors tenant rejetée (BadRequestException)
 *
 * Isolation : chaque test utilise un tenantId unique (namespace RUN) pour éviter
 * les interférences avec les autres suites sur la DB partagée.
 */

import { PrismaClient } from '@prisma/client';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@infra/database/prisma.service';
import { AgencyService } from '@modules/agency/agency.service';

const RUN = `ag-integ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const TENANT_ID = `tenant-${RUN}`;

let prismaClient: PrismaClient;
let service:      AgencyService;

beforeAll(async () => {
  prismaClient = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  await prismaClient.$connect();

  // Adapter PrismaClient → PrismaService (transact minimal compatible)
  const prisma = prismaClient as unknown as PrismaService;
  (prisma as unknown as { transact: (fn: (tx: PrismaService) => Promise<unknown>) => Promise<unknown> }).transact =
    (fn) => prismaClient.$transaction((tx) => fn(tx as unknown as PrismaService));

  service = new AgencyService(prisma);

  await prismaClient.tenant.upsert({
    where:  { id: TENANT_ID },
    update: {},
    create: { id: TENANT_ID, slug: RUN, name: `Tenant ${RUN}`, provisionStatus: 'ACTIVE' },
  });
});

afterAll(async () => {
  // Cleanup — ordre FK-safe. Les caisses VIRTUAL sont créées à la volée par
  // le service (getOrCreateVirtualRegister) et retiennent une FK sur Agency,
  // donc on les purge avant agency.deleteMany (et leurs transactions avant elles).
  await prismaClient.user.deleteMany({ where: { tenantId: TENANT_ID } });
  const vregs = await prismaClient.cashRegister.findMany({
    where:  { tenantId: TENANT_ID, kind: 'VIRTUAL' },
    select: { id: true },
  });
  if (vregs.length > 0) {
    const ids = vregs.map((r: { id: string }) => r.id);
    await prismaClient.transaction.deleteMany({ where: { tenantId: TENANT_ID, cashRegisterId: { in: ids } } });
    await prismaClient.cashRegister.deleteMany({ where: { tenantId: TENANT_ID, id: { in: ids } } });
  }
  await prismaClient.agency.deleteMany({ where: { tenantId: TENANT_ID } });
  await prismaClient.tenant.delete({ where: { id: TENANT_ID } }).catch(() => {/* idempotent */});
  await prismaClient.$disconnect();
});

describe('AgencyService — intégration CRUD + invariant', () => {
  it('création de la 1ʳᵉ agence puis suppression refusée (dernière)', async () => {
    const a1 = await service.create(TENANT_ID, { name: 'Siège' });
    expect(a1.name).toBe('Siège');

    const list1 = await service.findAll(TENANT_ID);
    expect(list1).toHaveLength(1);

    await expect(service.remove(TENANT_ID, a1.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('après création d\'une 2ᵉ agence, on peut supprimer la 1ʳᵉ ; users détachés', async () => {
    const existing = await service.findAll(TENANT_ID);
    const a1Id = existing[0]!.id;

    const a2 = await service.create(TENANT_ID, { name: 'Paris' });
    expect(a2.id).not.toBe(a1Id);

    // User rattaché à a1 — sera détaché à la suppression
    const user = await prismaClient.user.create({
      data: {
        email:    `user-${RUN}@test.local`,
        name:     'User Test',
        tenantId: TENANT_ID,
        agencyId: a1Id,
        userType: 'STAFF',
      },
    });

    await expect(service.remove(TENANT_ID, a1Id)).resolves.toEqual({ deleted: true });

    const reloaded = await prismaClient.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.agencyId).toBeNull();

    const remaining = await service.findAll(TENANT_ID);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(a2.id);
  });

  it('rejette une station qui n\'appartient pas au tenant (BadRequestException)', async () => {
    await expect(
      service.create(TENANT_ID, { name: 'Lyon', stationId: 'station-inexistante' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update accepte le renommage et trim les espaces', async () => {
    const existing = await service.findAll(TENANT_ID);
    const id = existing[0]!.id;

    const updated = await service.update(TENANT_ID, id, { name: '  Lyon Part-Dieu  ' });
    expect(updated.name).toBe('Lyon Part-Dieu');
  });
});
