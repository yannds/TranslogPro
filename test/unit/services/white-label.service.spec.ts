/**
 * WhiteLabelService — Tests unitaires
 *
 * Stratégie : mocks Prisma + Redis. Vérifie la logique de cache,
 * la construction du style tag CSS, la sanitisation CSS et l'invalidation du cache.
 */

import { WhiteLabelService } from '../../../src/modules/white-label/white-label.service';
import { PrismaService } from '../../../src/infrastructure/database/prisma.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const T = 'tenant-wl-001';

const FIXTURE_BRAND = {
  id:             'brd-01',
  tenantId:       T,
  brandName:      'Test Transport',
  logoUrl:        null,
  faviconUrl:     null,
  primaryColor:   '#2563eb',
  secondaryColor: '#1a3a5c',
  accentColor:    '#f59e0b',
  textColor:      '#111827',
  bgColor:        '#ffffff',
  fontFamily:     'Inter, sans-serif',
  customCss:      null,
  metaTitle:      'Test Transport',
  metaDescription: null,
  supportEmail:   null,
  supportPhone:   null,
  updatedAt:      new Date(),
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

function makePrisma(brand: unknown = FIXTURE_BRAND): jest.Mocked<PrismaService> {
  return {
    tenantBrand: {
      findUnique: jest.fn().mockResolvedValue(brand),
      upsert:     jest.fn().mockResolvedValue(brand),
      delete:     jest.fn().mockResolvedValue(brand),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

function makeRedis(cachedValue: string | null = null) {
  return {
    get:   jest.fn().mockResolvedValue(cachedValue),
    setex: jest.fn().mockResolvedValue('OK'),
    del:   jest.fn().mockResolvedValue(1),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WhiteLabelService', () => {
  let service: WhiteLabelService;
  let prisma:  jest.Mocked<PrismaService>;
  let redis:   ReturnType<typeof makeRedis>;

  beforeEach(() => {
    prisma  = makePrisma();
    redis   = makeRedis();
    service = new WhiteLabelService(prisma, redis as unknown as any);
  });

  // ── getBrand() ────────────────────────────────────────────────────────────

  describe('getBrand()', () => {
    it('retourne le cache Redis s\'il est présent (cache-first)', async () => {
      const cached = JSON.stringify(FIXTURE_BRAND);
      redis = makeRedis(cached);
      service = new WhiteLabelService(prisma, redis as unknown as any);
      const result = await service.getBrand(T);
      expect(redis.get).toHaveBeenCalledWith(`brand:${T}`);
      expect(prisma.tenantBrand.findUnique).not.toHaveBeenCalled();
    });

    it('lit la DB si le cache est vide', async () => {
      const result = await service.getBrand(T);
      expect(prisma.tenantBrand.findUnique).toHaveBeenCalledWith({ where: { tenantId: T } });
    });

    it('stocke la marque en cache Redis après lecture DB', async () => {
      await service.getBrand(T);
      expect(redis.setex).toHaveBeenCalledWith(
        `brand:${T}`,
        300,
        expect.any(String),
      );
    });

    it('retourne null si aucune marque configurée', async () => {
      prisma = makePrisma(null);
      service = new WhiteLabelService(prisma, redis as unknown as any);
      const result = await service.getBrand(T);
      expect(result).toBeNull();
    });
  });

  // ── upsert() ──────────────────────────────────────────────────────────────

  describe('upsert()', () => {
    it('appelle tenantBrand.upsert() avec les bons champs', async () => {
      await service.upsert(T, {
        brandName:    'Nouveau Nom',
        primaryColor: '#1e40af',
        secondaryColor: '#1a3a5c',
        accentColor:  '#f59e0b',
        textColor:    '#111827',
        bgColor:      '#ffffff',
        fontFamily:   'Inter, sans-serif',
      });
      expect(prisma.tenantBrand.upsert).toHaveBeenCalled();
    });

    it('invalide le cache après upsert', async () => {
      await service.upsert(T, {
        brandName:    'Updated',
        primaryColor: '#1e40af',
        secondaryColor: '#1a3a5c',
        accentColor:  '#f59e0b',
        textColor:    '#111827',
        bgColor:      '#ffffff',
        fontFamily:   'Inter, sans-serif',
      });
      expect(redis.del).toHaveBeenCalledWith(`brand:${T}`);
    });
  });

  // ── remove() ─────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('supprime la marque et invalide le cache', async () => {
      await service.remove(T);
      expect(prisma.tenantBrand.delete).toHaveBeenCalledWith({ where: { tenantId: T } });
      expect(redis.del).toHaveBeenCalledWith(`brand:${T}`);
    });
  });

  // ── buildStyleTag() ───────────────────────────────────────────────────────

  describe('buildStyleTag()', () => {
    it('génère un bloc <style data-tenant-brand> valide', () => {
      const style = service.buildStyleTag(FIXTURE_BRAND as any);
      expect(style).toContain('<style data-tenant-brand>');
      expect(style).toContain('--color-primary: #2563eb');
      expect(style).toContain('--color-bg: #ffffff');
      expect(style).toContain('</style>');
    });

    it('inclut customCss si présent', () => {
      const brand = { ...FIXTURE_BRAND, customCss: '.logo { display: none; }' };
      const style = service.buildStyleTag(brand as any);
      expect(style).toContain('.logo { display: none; }');
    });

    it('filtre les @import dans customCss (sanitisation)', () => {
      const brand = { ...FIXTURE_BRAND, customCss: '@import url("evil.css"); .ok { color: red; }' };
      const style = service.buildStyleTag(brand as any);
      expect(style).not.toContain('@import');
    });

    it('filtre les url() dans customCss', () => {
      const brand = { ...FIXTURE_BRAND, customCss: 'background: url("http://evil.com/x.png");' };
      const style = service.buildStyleTag(brand as any);
      expect(style).not.toContain('url(');
    });

    it('filtre javascript: dans customCss', () => {
      const brand = { ...FIXTURE_BRAND, customCss: 'content: "javascript:alert(1)"' };
      const style = service.buildStyleTag(brand as any);
      expect(style).not.toContain('javascript:');
    });
  });

  // ── buildThemeTokens() ───────────────────────────────────────────────────

  describe('buildThemeTokens()', () => {
    it('retourne un objet avec les tokens CSS attendus', () => {
      const tokens = service.buildThemeTokens(FIXTURE_BRAND as any);
      expect(tokens).toHaveProperty('--color-primary', '#2563eb');
      expect(tokens).toHaveProperty('--color-bg', '#ffffff');
    });
  });
});
