/**
 * FlightDeckService.getTripLiveStats — logique "Prévu / Estimé / Effectif"
 *
 * Couvre les 4 états du cycle de vie d'un trajet :
 *   1. Pas encore parti (departureActual NULL)        → ROLLING
 *   2. Parti, pas encore arrivé (departureActual !NULL) → FROZEN départ
 *   3. Arrivé (arrivalActual !NULL)                   → FROZEN arrivée
 *   4. CANCELLED                                       → estimés null
 *
 * Le contrat testé est strict : une fois departureActual posé, l'estimation
 * ne doit JAMAIS bouger même si le temps passe — c'est ce qui évite que les
 * écrans publics continuent de "courir" après le départ effectif.
 */

import { FlightDeckService } from '../../../src/modules/flight-deck/flight-deck.service';

describe('FlightDeckService.getTripLiveStats — Prévu/Estimé/Effectif', () => {
  let prismaMock: any;
  let service:    FlightDeckService;

  // Référence temporelle stable — toutes les assertions calculent par rapport
  // à NOW pour rester déterministes même si la suite passe à minuit.
  const NOW = new Date('2026-04-19T17:25:00.000Z').getTime();

  function buildTrip(overrides: Partial<{
    status: string;
    departureScheduled: Date | null;
    arrivalScheduled:   Date | null;
    departureActual:    Date | null;
    arrivalActual:      Date | null;
  }> = {}) {
    return {
      id: 'T1',
      status: 'PLANNED',
      departureScheduled: new Date('2026-04-19T07:00:00.000Z'),
      arrivalScheduled:   new Date('2026-04-19T13:00:00.000Z'),
      departureActual:    null,
      arrivalActual:      null,
      bus: { capacity: 60 },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);

    prismaMock = {
      trip: { findFirst: jest.fn() },
      traveler: { count: jest.fn().mockResolvedValue(0) },
      ticket:   { count: jest.fn().mockResolvedValue(0) },
      parcel:   { count: jest.fn().mockResolvedValue(0) },
    };
    service = new FlightDeckService(prismaMock, {} as any, {} as any);
  });

  afterEach(() => jest.restoreAllMocks());

  // ─── État 1 — Pas encore parti (rolling) ─────────────────────────────────

  it('état 1 (rolling): trajet PLANNED, retard accumulé = now - scheduledDeparture', async () => {
    // Scheduled 07:00 UTC, now 17:25 UTC → 10h25 = 625 min de retard
    prismaMock.trip.findFirst.mockResolvedValue(buildTrip({ status: 'BOARDING' }));

    const stats = await service.getTripLiveStats('tenant', 'T1');

    expect(stats.delayMinutes).toBe(625);
    expect(stats.isFrozen).toBe(false);
    expect(stats.actualDeparture).toBeNull();
    // Estimé = scheduled + 625min
    expect(new Date(stats.estimatedDeparture!).toISOString())
      .toBe('2026-04-19T17:25:00.000Z');
    expect(new Date(stats.estimatedArrival!).toISOString())
      .toBe('2026-04-19T23:25:00.000Z');
  });

  it('état 1 (à l\'heure): trajet PLANNED non en retard → estimés null, delay 0', async () => {
    // Scheduled dans 1h, now < scheduled → pas de retard
    prismaMock.trip.findFirst.mockResolvedValue(buildTrip({
      departureScheduled: new Date(NOW + 3_600_000),
      arrivalScheduled:   new Date(NOW + 3_600_000 + 6 * 3_600_000),
    }));

    const stats = await service.getTripLiveStats('tenant', 'T1');

    expect(stats.delayMinutes).toBe(0);
    expect(stats.estimatedDeparture).toBeNull();
    expect(stats.estimatedArrival).toBeNull();
    expect(stats.isFrozen).toBe(false);
  });

  // ─── État 2 — Parti, pas arrivé (FIGÉ départ) ────────────────────────────

  it('état 2 (frozen départ): IN_PROGRESS avec departureActual → départ figé, arrivée projetée', async () => {
    // Bus parti à 17:25 (10h25 de retard sur 07:00). Trajet nominal 6h.
    // → arrivée projetée FIGÉE = 13:00 + 10h25 = 23:25. NE BOUGE PAS si on
    //   appelle 5 minutes plus tard (= test de non-rolling).
    const departureActual = new Date('2026-04-19T17:25:00.000Z');
    prismaMock.trip.findFirst.mockResolvedValue(buildTrip({
      status: 'IN_PROGRESS',
      departureActual,
    }));

    const stats = await service.getTripLiveStats('tenant', 'T1');

    expect(stats.isFrozen).toBe(true);
    expect(stats.delayMinutes).toBe(625);
    expect(stats.actualDeparture).toBe(departureActual.toISOString());
    expect(new Date(stats.estimatedDeparture!).toISOString()).toBe(departureActual.toISOString());
    expect(new Date(stats.estimatedArrival!).toISOString()).toBe('2026-04-19T23:25:00.000Z');
  });

  it('état 2: si le temps avance, l\'estimation reste FIGÉE (pas de rolling)', async () => {
    const departureActual = new Date('2026-04-19T17:25:00.000Z');
    prismaMock.trip.findFirst.mockResolvedValue(buildTrip({
      status: 'IN_PROGRESS',
      departureActual,
    }));

    const stats1 = await service.getTripLiveStats('tenant', 'T1');

    // Avance de 5 min — l'estimation NE DOIT PAS bouger
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 5 * 60_000);
    const stats2 = await service.getTripLiveStats('tenant', 'T1');

    expect(stats2.estimatedDeparture).toBe(stats1.estimatedDeparture);
    expect(stats2.estimatedArrival).toBe(stats1.estimatedArrival);
    expect(stats2.delayMinutes).toBe(stats1.delayMinutes);
  });

  it('état 2: bus parti EN AVANCE → delayMinutes = 0 (pas de retard négatif)', async () => {
    const departureActual = new Date('2026-04-19T06:55:00.000Z'); // 5 min avant
    prismaMock.trip.findFirst.mockResolvedValue(buildTrip({
      status: 'IN_PROGRESS',
      departureActual,
    }));

    const stats = await service.getTripLiveStats('tenant', 'T1');

    expect(stats.delayMinutes).toBe(0);
    expect(stats.isFrozen).toBe(true);
    // Arrivée projetée = arrivée prévue (delay=0)
    expect(new Date(stats.estimatedArrival!).toISOString()).toBe('2026-04-19T13:00:00.000Z');
  });

  // ─── État 3 — Arrivé (FIGÉ arrivée) ──────────────────────────────────────

  it('état 3 (frozen arrivée): COMPLETED → arrivée = arrivalActual (pas l\'estimée)', async () => {
    const departureActual = new Date('2026-04-19T17:25:00.000Z');
    const arrivalActual   = new Date('2026-04-19T22:50:00.000Z'); // arrivé en avance vs estimé 23:25
    prismaMock.trip.findFirst.mockResolvedValue(buildTrip({
      status: 'COMPLETED',
      departureActual,
      arrivalActual,
    }));

    const stats = await service.getTripLiveStats('tenant', 'T1');

    expect(stats.isFrozen).toBe(true);
    expect(stats.actualArrival).toBe(arrivalActual.toISOString());
    expect(new Date(stats.estimatedArrival!).toISOString()).toBe(arrivalActual.toISOString());
  });

  // ─── État 4 — CANCELLED ──────────────────────────────────────────────────

  it('état 4 (cancelled): aucune estimation, delay 0', async () => {
    prismaMock.trip.findFirst.mockResolvedValue(buildTrip({ status: 'CANCELLED' }));

    const stats = await service.getTripLiveStats('tenant', 'T1');

    expect(stats.delayMinutes).toBe(0);
    expect(stats.estimatedDeparture).toBeNull();
    expect(stats.estimatedArrival).toBeNull();
  });

  // ─── Contrats secondaires ────────────────────────────────────────────────

  it('expose actualDeparture/actualArrival bruts au client (audit + UI driver)', async () => {
    const dep = new Date('2026-04-19T17:25:00.000Z');
    const arr = new Date('2026-04-19T22:50:00.000Z');
    prismaMock.trip.findFirst.mockResolvedValue(buildTrip({
      status: 'COMPLETED', departureActual: dep, arrivalActual: arr,
    }));

    const stats = await service.getTripLiveStats('tenant', 'T1');

    expect(stats.actualDeparture).toBe(dep.toISOString());
    expect(stats.actualArrival).toBe(arr.toISOString());
    expect(stats.scheduledDeparture).toBe('2026-04-19T07:00:00.000Z');
    expect(stats.scheduledArrival).toBe('2026-04-19T13:00:00.000Z');
  });
});
