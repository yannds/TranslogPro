/**
 * FlightDeckService.transitionTripStatus — guards + stamp horodatages.
 *
 * Couvre :
 *   - Guard "MANIFEST_NOT_SIGNED" : refus IN_PROGRESS sans manifest signé
 *   - Stamp departureActual à IN_PROGRESS / arrivalActual à COMPLETED
 *   - Defense in depth : trip pas assigné au chauffeur → ForbiddenException
 *
 * Le test mock WorkflowEngine pour vérifier que le persist callback reçoit
 * bien les horodatages — on ne re-teste pas l'engine lui-même (cf. ses
 * propres specs).
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FlightDeckService } from '../../../src/modules/flight-deck/flight-deck.service';

describe('FlightDeckService.transitionTripStatus', () => {
  let prismaMock: any;
  let workflowMock: any;
  let service: FlightDeckService;

  beforeEach(() => {
    prismaMock = {
      trip: {
        findFirst: jest.fn(),
        update:    jest.fn(),
      },
      staff: {
        findFirst: jest.fn(),
      },
      manifest: {
        findFirst: jest.fn(),
      },
    };

    // Workflow engine "passe-plat" : appelle persist(entity, toState, prisma)
    // et retourne un résultat compatible. Mappe les actions blueprint réelles
    // (cf. TripAction enum dans workflow-states.ts) vers le toState attendu.
    workflowMock = {
      transition: jest.fn(async (entity: any, input: any, cfg: any) => {
        const state = input.action === 'DEPART'         ? 'IN_PROGRESS'
                    : input.action === 'END_TRIP'       ? 'COMPLETED'
                    : input.action === 'START_BOARDING' ? 'OPEN'
                    : input.action === 'BEGIN_BOARDING' ? 'BOARDING'
                    : entity.status;
        await cfg.persist(entity, state, prismaMock);
        return { entity: { ...entity, status: state }, toState: state, fromState: entity.status };
      }),
    };

    service = new FlightDeckService(prismaMock, {} as any, workflowMock);
  });

  // ─── Guard manifest ──────────────────────────────────────────────────────

  it('refuse IN_PROGRESS si AUCUN manifest SIGNED (MANIFEST_NOT_SIGNED)', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', status: 'BOARDING', driverId: 'staff1', tenantId: 'tenant', version: 1,
    });
    prismaMock.staff.findFirst.mockResolvedValue({ id: 'staff1' });
    prismaMock.manifest.findFirst.mockResolvedValue(null); // <- aucun manifest signé

    await expect(
      service.transitionTripStatus('tenant', 'T', 'user1', 'IN_PROGRESS'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.transitionTripStatus('tenant', 'T', 'user1', 'IN_PROGRESS'),
    ).rejects.toThrow(/MANIFEST_NOT_SIGNED/);

    expect(workflowMock.transition).not.toHaveBeenCalled();
  });

  it('autorise IN_PROGRESS si AU MOINS UN manifest SIGNED existe', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', status: 'BOARDING', driverId: 'staff1', tenantId: 'tenant', version: 1,
    });
    prismaMock.staff.findFirst.mockResolvedValue({ id: 'staff1' });
    prismaMock.manifest.findFirst.mockResolvedValue({ id: 'M1', kind: 'ALL', signedAt: new Date() });
    prismaMock.trip.update.mockImplementation(async ({ data }: any) => ({
      id: 'T', status: data.status, version: 2, ...data,
    }));

    const res = await service.transitionTripStatus('tenant', 'T', 'user1', 'IN_PROGRESS');

    expect(workflowMock.transition).toHaveBeenCalled();
    expect(res.status).toBe('IN_PROGRESS');
  });

  it('NE bloque PAS la transition vers BOARDING (manifest se signe pendant)', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', status: 'PLANNED', driverId: 'staff1', tenantId: 'tenant', version: 1,
    });
    prismaMock.staff.findFirst.mockResolvedValue({ id: 'staff1' });
    prismaMock.trip.update.mockImplementation(async ({ data }: any) => ({
      id: 'T', status: data.status ?? 'BOARDING', version: 2, ...data,
    }));

    await expect(
      service.transitionTripStatus('tenant', 'T', 'user1', 'BOARDING'),
    ).resolves.toBeDefined();

    // Le check manifest n'est même pas appelé pour BOARDING
    expect(prismaMock.manifest.findFirst).not.toHaveBeenCalled();
  });

  // ─── Stamp horodatages ───────────────────────────────────────────────────

  it('stampe departureActual quand transition vers IN_PROGRESS', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', status: 'BOARDING', driverId: 'staff1', tenantId: 'tenant', version: 1,
    });
    prismaMock.staff.findFirst.mockResolvedValue({ id: 'staff1' });
    prismaMock.manifest.findFirst.mockResolvedValue({ id: 'M1' });
    prismaMock.trip.update.mockImplementation(async ({ data }: any) => ({
      id: 'T', status: data.status, version: 2, ...data,
    }));

    await service.transitionTripStatus('tenant', 'T', 'user1', 'IN_PROGRESS');

    const updateCall = prismaMock.trip.update.mock.calls.at(-1)![0];
    expect(updateCall.data.status).toBe('IN_PROGRESS');
    expect(updateCall.data.departureActual).toBeInstanceOf(Date);
    // Pas d'arrivalActual lors d'un IN_PROGRESS
    expect(updateCall.data.arrivalActual).toBeUndefined();
  });

  it('stampe arrivalActual quand transition vers COMPLETED', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', status: 'IN_PROGRESS', driverId: 'staff1', tenantId: 'tenant', version: 1,
    });
    prismaMock.staff.findFirst.mockResolvedValue({ id: 'staff1' });
    prismaMock.trip.update.mockImplementation(async ({ data }: any) => ({
      id: 'T', status: data.status, version: 2, ...data,
    }));

    await service.transitionTripStatus('tenant', 'T', 'user1', 'COMPLETED');

    const updateCall = prismaMock.trip.update.mock.calls.at(-1)![0];
    expect(updateCall.data.status).toBe('COMPLETED');
    expect(updateCall.data.arrivalActual).toBeInstanceOf(Date);
  });

  // ─── Defense in depth ────────────────────────────────────────────────────

  it('refuse 403 si trip pas assigné au chauffeur', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', status: 'BOARDING', driverId: 'staff_other', tenantId: 'tenant', version: 1,
    });
    prismaMock.staff.findFirst.mockResolvedValue({ id: 'staff1' });

    await expect(
      service.transitionTripStatus('tenant', 'T', 'user1', 'IN_PROGRESS'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuse 404 si trip introuvable dans le tenant (isolation)', async () => {
    prismaMock.trip.findFirst.mockResolvedValue(null);

    await expect(
      service.transitionTripStatus('tenant', 'T', 'user1', 'IN_PROGRESS'),
    ).rejects.toThrow(NotFoundException);
  });
});
