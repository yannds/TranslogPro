/**
 * OnboardingWizardService.getState — tests unitaires.
 *
 * Couvre la refonte 2026-04-26 : la WelcomePage post-onboarding consomme
 * désormais un bloc `activation` (bus, trip, firstTicket, firstParcel, team,
 * hasDemoSeed) pour afficher une checklist véridique par dépendance plutôt
 * qu'une promesse mensongère ("Vendre votre 1er billet" sans Bus/Trip).
 *
 * Les tests vérifient :
 *   - Comptage correct des entités activation (bus / trip / ticket / parcel)
 *   - Filtrage : Ticket exclus si CANCELLED ou EXPIRED
 *   - Détection seed démo via préfixe `[DÉMO] ` sur Bus.model (pas de migration)
 *   - Compatibilité régressive : `steps` du wizard inchangé
 *   - NotFoundException si tenant introuvable
 */

import { NotFoundException } from '@nestjs/common';
import { OnboardingWizardService } from '@modules/onboarding-wizard/onboarding-wizard.service';

const TENANT_ID = 'tenant-wiz-001';

function makePrismaMock(overrides: Partial<{
  tenant:      any;
  brand:       any;
  agencyCount: number;
  stationCount: number;
  routeCount:  number;
  userCount:   number;
  busCount:    number;
  tripCount:   number;
  ticketCount: number;
  parcelCount: number;
  demoBusCount: number;
}> = {}) {
  // 'tenant' in overrides → respecter null explicite ; sinon défaut.
  const tenantValue = 'tenant' in overrides ? overrides.tenant : {
    name: 'Acme', slug: 'acme', language: 'fr', country: 'CG', currency: 'XAF',
    businessActivity: 'TICKETING', onboardingCompletedAt: null,
  };
  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(tenantValue),
    },
    tenantBrand: { findUnique: jest.fn().mockResolvedValue(overrides.brand ?? null) },
    agency:      { count: jest.fn().mockResolvedValue(overrides.agencyCount  ?? 1) },
    station:     {
      count:     jest.fn().mockResolvedValue(overrides.stationCount ?? 1),
      findFirst: jest.fn().mockResolvedValue({ id: 'station-1' }),
    },
    route:       { count: jest.fn().mockResolvedValue(overrides.routeCount   ?? 0) },
    user:        { count: jest.fn().mockResolvedValue(overrides.userCount    ?? 1) },
    bus: {
      // 1er appel = busCount global, 2ème appel = demoBusCount (filtre [DÉMO])
      count: jest.fn()
        .mockResolvedValueOnce(overrides.busCount ?? 0)
        .mockResolvedValueOnce(overrides.demoBusCount ?? 0),
    },
    trip:   { count: jest.fn().mockResolvedValue(overrides.tripCount   ?? 0) },
    ticket: { count: jest.fn().mockResolvedValue(overrides.ticketCount ?? 0) },
    parcel: { count: jest.fn().mockResolvedValue(overrides.parcelCount ?? 0) },
  };
}

function makeService(prismaMock: any) {
  return new OnboardingWizardService(
    prismaMock,
    { publicBaseDomain: 'translogpro.local' } as any,
    { send: jest.fn() } as any,
  );
}

describe('OnboardingWizardService.getState — bloc activation', () => {
  it("retourne `activation.bus = false` quand aucun bus n'existe", async () => {
    const prisma = makePrismaMock({ busCount: 0 });
    const svc = makeService(prisma);
    const res = await svc.getState(TENANT_ID);
    expect(res.activation.bus).toBe(false);
  });

  it("retourne `activation.bus = true` dès qu'un bus existe", async () => {
    const prisma = makePrismaMock({ busCount: 3 });
    const svc = makeService(prisma);
    const res = await svc.getState(TENANT_ID);
    expect(res.activation.bus).toBe(true);
  });

  it("retourne `activation.trip = true` quand au moins un trip existe", async () => {
    const prisma = makePrismaMock({ tripCount: 1 });
    const svc = makeService(prisma);
    const res = await svc.getState(TENANT_ID);
    expect(res.activation.trip).toBe(true);
  });

  it("compte `firstTicket` en excluant CANCELLED et EXPIRED", async () => {
    const prisma = makePrismaMock({ ticketCount: 5 });
    const svc = makeService(prisma);
    await svc.getState(TENANT_ID);
    // Vérifie que la query ticket.count est appelée avec le filtre status notIn.
    expect(prisma.ticket.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, status: { notIn: ['CANCELLED', 'EXPIRED'] } },
    });
  });

  it("retourne `activation.firstTicket = true` quand un ticket actif existe", async () => {
    const prisma = makePrismaMock({ ticketCount: 1 });
    const svc = makeService(prisma);
    const res = await svc.getState(TENANT_ID);
    expect(res.activation.firstTicket).toBe(true);
  });

  it("retourne `activation.firstParcel = true` quand un colis existe", async () => {
    const prisma = makePrismaMock({ parcelCount: 1 });
    const svc = makeService(prisma);
    const res = await svc.getState(TENANT_ID);
    expect(res.activation.firstParcel).toBe(true);
  });

  it("retourne `activation.team = true` quand userCount > 1 (admin + au moins 1 invité)", async () => {
    const prisma = makePrismaMock({ userCount: 2 });
    const svc = makeService(prisma);
    const res = await svc.getState(TENANT_ID);
    expect(res.activation.team).toBe(true);
  });

  it("détecte seed démo via préfixe `[DÉMO] ` sur Bus.model", async () => {
    const prisma = makePrismaMock({ busCount: 1, demoBusCount: 1 });
    const svc = makeService(prisma);
    const res = await svc.getState(TENANT_ID);
    expect(res.activation.hasDemoSeed).toBe(true);
    // Vérifie que la query démo cible bien startsWith '[DÉMO] '.
    expect(prisma.bus.count).toHaveBeenNthCalledWith(2, {
      where: { tenantId: TENANT_ID, model: { startsWith: '[DÉMO] ' } },
    });
  });

  it("hasDemoSeed = false quand aucun bus démo (même si bus 'normaux' existent)", async () => {
    const prisma = makePrismaMock({ busCount: 5, demoBusCount: 0 });
    const svc = makeService(prisma);
    const res = await svc.getState(TENANT_ID);
    expect(res.activation.hasDemoSeed).toBe(false);
  });

  it("conserve le bloc `steps` historique du wizard (régression)", async () => {
    const prisma = makePrismaMock({
      brand: { brandName: 'Acme', logoUrl: null, primaryColor: '#0d9488' },
      agencyCount: 1, stationCount: 1, routeCount: 1, userCount: 2,
    });
    const svc = makeService(prisma);
    const res = await svc.getState(TENANT_ID);
    expect(res.steps).toEqual({
      brand: true, agency: true, station: true, route: true, team: true,
    });
    expect(res.completedCount).toBe(5);
    expect(res.totalSteps).toBe(5);
  });

  it("lance NotFoundException si tenant inexistant", async () => {
    const prisma = makePrismaMock({ tenant: null });
    const svc = makeService(prisma);
    await expect(svc.getState(TENANT_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("retourne firstStationId du premier Station (pour reprise wizard)", async () => {
    const prisma = makePrismaMock({ stationCount: 2 });
    const svc = makeService(prisma);
    const res = await svc.getState(TENANT_ID);
    expect(res.firstStationId).toBe('station-1');
  });
});
