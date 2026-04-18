/**
 * PlatformConfigService — tests unitaires
 *
 * Couvre :
 *   - getNumber/getBoolean/getString : lecture typée avec fallback sur default
 *   - Cache 60s : deuxième appel ne requête pas la DB
 *   - set : upsert + invalidation cache + audit updatedBy
 *   - setBatch : validation globale avant transaction
 *   - reset : delete + invalidation
 *   - Fallback DB down : retombe sur default sans throw
 *   - Validation : out of range rejeté
 */

import { PlatformConfigService } from '../../../src/modules/platform-config/platform-config.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

function createPrismaMock() {
  const rows = new Map<string, { key: string; value: unknown; updatedBy: string | null }>();
  return {
    platformConfig: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null),
      findMany:   jest.fn(async () => Array.from(rows.values())),
      upsert:     jest.fn(async ({ where, create, update }: { where: { key: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = rows.get(where.key);
        const next = existing
          ? { ...existing, ...update } as { key: string; value: unknown; updatedBy: string | null }
          : { ...create } as { key: string; value: unknown; updatedBy: string | null };
        rows.set(where.key, next);
        return next;
      }),
      deleteMany: jest.fn(async ({ where }: { where: { key: string } }) => {
        const existed = rows.has(where.key);
        rows.delete(where.key);
        return { count: existed ? 1 : 0 };
      }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    __rows: rows,
  };
}

describe('PlatformConfigService', () => {
  let service: PlatformConfigService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new PlatformConfigService(prisma as unknown as never);
  });

  describe('getNumber — fallback sur default', () => {
    it('retourne le default si la clé est absente de la DB', async () => {
      const v = await service.getNumber('health.riskThreshold');
      expect(v).toBe(60);
    });

    it('retourne la valeur DB si présente', async () => {
      prisma.__rows.set('health.riskThreshold', { key: 'health.riskThreshold', value: 75, updatedBy: null });
      const v = await service.getNumber('health.riskThreshold');
      expect(v).toBe(75);
    });

    it('lève si la clé n\'est pas registre (pas de magic string accepté)', async () => {
      await expect(service.getNumber('not.registered.key')).rejects.toThrow(/not registered/);
    });
  });

  describe('cache TTL', () => {
    it('ne refait pas la requête DB au 2e appel', async () => {
      await service.getNumber('health.riskThreshold');
      await service.getNumber('health.riskThreshold');
      await service.getNumber('health.riskThreshold');
      expect(prisma.platformConfig.findUnique).toHaveBeenCalledTimes(1);
    });

    it('invalide le cache après set()', async () => {
      await service.getNumber('health.riskThreshold');
      await service.set('health.riskThreshold', 42, 'user-1');
      await service.getNumber('health.riskThreshold');
      // 1 lecture initiale + 1 après invalidation = 2
      expect(prisma.platformConfig.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('set — validation & upsert', () => {
    it('upsert avec actorId tracé', async () => {
      await service.set('health.riskThreshold', 80, 'actor-abc');
      expect(prisma.platformConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where:  { key: 'health.riskThreshold' },
          create: expect.objectContaining({ key: 'health.riskThreshold', value: 80, updatedBy: 'actor-abc' }),
          update: expect.objectContaining({ value: 80, updatedBy: 'actor-abc' }),
        }),
      );
    });

    it('coerce les strings numériques', async () => {
      await service.set('health.riskThreshold', '42', 'user-1');
      expect(prisma.__rows.get('health.riskThreshold')?.value).toBe(42);
    });

    it('rejette une valeur hors bornes (riskThreshold > 100)', async () => {
      await expect(service.set('health.riskThreshold', 150, 'u')).rejects.toThrow(BadRequestException);
    });

    it('rejette une clé inconnue', async () => {
      await expect(service.set('fake.key', 1, 'u')).rejects.toThrow(NotFoundException);
    });

    it('rejette un type invalide', async () => {
      await expect(service.set('health.riskThreshold', { nested: true }, 'u')).rejects.toThrow(BadRequestException);
    });
  });

  describe('setBatch — atomique', () => {
    it('valide toutes les entrées avant d\'écrire', async () => {
      await expect(service.setBatch(
        [
          { key: 'health.riskThreshold',        value: 70 },
          { key: 'health.thresholds.incidents', value: 9999 }, // hors bornes (max=1000)
        ],
        'actor-1',
      )).rejects.toThrow(BadRequestException);

      // La première entrée valide ne doit PAS avoir été écrite
      expect(prisma.__rows.has('health.riskThreshold')).toBe(false);
    });

    it('écrit toutes les entrées en transaction si toutes valides', async () => {
      await service.setBatch(
        [
          { key: 'health.riskThreshold', value: 70 },
          { key: 'billing.defaultInvoiceDueDays', value: 14 },
        ],
        'actor-1',
      );
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.__rows.size).toBe(2);
    });
  });

  describe('reset', () => {
    it('supprime la ligne DB et invalide le cache', async () => {
      await service.set('health.riskThreshold', 80, 'u');
      await service.getNumber('health.riskThreshold'); // warm cache
      await service.reset('health.riskThreshold');

      const v = await service.getNumber('health.riskThreshold');
      expect(v).toBe(60); // fallback sur default
    });
  });

  describe('fallback résilience DB', () => {
    it('retourne le default si findUnique throw', async () => {
      prisma.platformConfig.findUnique = jest.fn().mockRejectedValue(new Error('DB down'));
      const v = await service.getNumber('health.riskThreshold');
      expect(v).toBe(60);
    });
  });

  describe('getAll — UI admin', () => {
    it('retourne le registre enrichi des valeurs courantes', async () => {
      prisma.__rows.set('health.riskThreshold', { key: 'health.riskThreshold', value: 77, updatedBy: null });
      const list = await service.getAll();
      const risk = list.find(e => e.key === 'health.riskThreshold');
      expect(risk).toBeDefined();
      expect(risk!.current).toBe(77);
      expect(risk!.isDefault).toBe(false);

      const dlq = list.find(e => e.key === 'health.thresholds.dlqEvents');
      expect(dlq!.current).toBe(5);        // default
      expect(dlq!.isDefault).toBe(true);
    });
  });
});
