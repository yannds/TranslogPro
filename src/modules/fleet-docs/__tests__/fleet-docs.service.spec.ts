/**
 * FleetDocsService — Tests unitaires
 *
 * Stratégie : instanciation directe du service avec un PrismaService mocké.
 * Tests focalisés sur les helpers privés (_computeDocStatus, _computeConsumableStatus)
 * exposés via des cas métier concrets.
 */

import { FleetDocsService } from '../fleet-docs.service';
import { PrismaService }    from '../../../infrastructure/database/prisma.service';

// ─── Helpers d'accès aux méthodes privées ─────────────────────────────────────

type PrivateFleetDocs = {
  _computeDocStatus(expiresAt: Date | undefined, alertDays: number): string;
  _computeConsumableStatus(
    currentKm:        number,
    lastReplacedKm:   number | null,
    nominalLifetimeKm: number,
    alertKmBefore:    number,
  ): string;
};

function asPrivate(svc: FleetDocsService): PrivateFleetDocs {
  return svc as unknown as PrivateFleetDocs;
}

// ─── Factories de dates relatives ─────────────────────────────────────────────

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {} as unknown as PrismaService;
const mockEventBus  = { publish: jest.fn() } as any;
const mockStorage   = {} as any;

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('FleetDocsService', () => {
  let svc: FleetDocsService;

  beforeEach(() => {
    svc = new FleetDocsService(mockPrisma, mockEventBus, mockStorage);
  });

  // ── _computeDocStatus ──────────────────────────────────────────────────────

  describe('_computeDocStatus()', () => {
    const p = () => asPrivate(svc);

    it('retourne MISSING si expiresAt est undefined', () => {
      expect(p()._computeDocStatus(undefined, 30)).toBe('MISSING');
    });

    it('retourne EXPIRED si la date est dans le passé', () => {
      expect(p()._computeDocStatus(daysFromNow(-1), 30)).toBe('EXPIRED');
    });

    it('retourne EXPIRING si dans la fenêtre d\'alerte (ex: 15j restants, alert=30j)', () => {
      expect(p()._computeDocStatus(daysFromNow(15), 30)).toBe('EXPIRING');
    });

    it('retourne VALID si hors fenêtre d\'alerte (ex: 60j restants, alert=30j)', () => {
      expect(p()._computeDocStatus(daysFromNow(60), 30)).toBe('VALID');
    });

    it('retourne EXPIRING exactement à la limite d\'alerte (0 days margin)', () => {
      // La limite d'alerte est aujourd'hui : now >= alertLimit → EXPIRING
      const expiresAt = daysFromNow(30);
      expect(p()._computeDocStatus(expiresAt, 30)).toBe('EXPIRING');
    });

    it('retourne VALID un jour avant la fenêtre d\'alerte', () => {
      expect(p()._computeDocStatus(daysFromNow(31), 30)).toBe('VALID');
    });
  });

  // ── _computeConsumableStatus ───────────────────────────────────────────────

  describe('_computeConsumableStatus()', () => {
    const p = () => asPrivate(svc);
    // Ex : huile moteur, durée nominale = 10 000 km, alerte à 1 000 km avant
    const NOMINAL = 10_000;
    const ALERT   = 1_000;

    it('retourne ALERT si jamais remplacé (lastReplacedKm = null)', () => {
      expect(p()._computeConsumableStatus(5_000, null, NOMINAL, ALERT)).toBe('ALERT');
    });

    it('retourne OK si très loin du prochain remplacement', () => {
      expect(p()._computeConsumableStatus(0, 0, NOMINAL, ALERT)).toBe('OK');
    });

    it('retourne ALERT si dans la fenêtre d\'alerte', () => {
      // lastReplaced=0, nextDue=10000, alertAt=9000, current=9500 → ALERT
      expect(p()._computeConsumableStatus(9_500, 0, NOMINAL, ALERT)).toBe('ALERT');
    });

    it('retourne OVERDUE si dépassé le kilométrage nominal', () => {
      // lastReplaced=0, nextDue=10000, current=10001 → OVERDUE
      expect(p()._computeConsumableStatus(10_001, 0, NOMINAL, ALERT)).toBe('OVERDUE');
    });

    it('retourne OVERDUE exactement à nextDueKm', () => {
      expect(p()._computeConsumableStatus(10_000, 0, NOMINAL, ALERT)).toBe('OVERDUE');
    });

    it('retourne ALERT exactement à alertAtKm', () => {
      expect(p()._computeConsumableStatus(9_000, 0, NOMINAL, ALERT)).toBe('ALERT');
    });

    it('retourne OK un km avant la fenêtre d\'alerte', () => {
      expect(p()._computeConsumableStatus(8_999, 0, NOMINAL, ALERT)).toBe('OK');
    });

    it('gère un remplacement récent (km actuel < last)', () => {
      // Odomètre remis à zéro ou correction — nextDue peut être dans le futur lointain
      expect(p()._computeConsumableStatus(100, 50_000, NOMINAL, ALERT)).toBe('OK');
    });
  });
});
