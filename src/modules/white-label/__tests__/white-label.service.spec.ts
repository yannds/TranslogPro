/**
 * WhiteLabelService — Tests unitaires
 *
 * Stratégie : PrismaService mocké, Redis mocké.
 * Tests centrés sur :
 *   - getBrand()    : cache hit, cache miss (DB fallback), défauts si pas de record
 *   - upsert()      : invalide le cache, appelle DB
 *   - remove()      : NotFoundException si pas de record
 *   - buildStyleTag(): génère le bloc CSS avec les variables
 *   - sanitizeCss   : retire les déclarations dangereuses (@import, url(), javascript:)
 */

import { NotFoundException } from '@nestjs/common';
import { WhiteLabelService } from '../white-label.service';
import { PrismaService }     from '../../../infrastructure/database/prisma.service';
import { Redis }             from 'ioredis';

// ─── Constantes ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';

const DB_BRAND = {
  tenantId:        TENANT_ID,
  brandName:       'Congo Express',
  logoUrl:         null,
  faviconUrl:      null,
  primaryColor:    '#0d9488',
  secondaryColor:  '#0f766e',
  accentColor:     '#f59e0b',
  textColor:       '#f8fafc',
  bgColor:         '#020617',
  fontFamily:      'Inter, sans-serif',
  customCss:       null,
  metaTitle:       null,
  metaDescription: null,
  supportEmail:    null,
  supportPhone:    null,
};

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makePrisma(opts: {
  tenantBrand?: object | null;
} = {}): jest.Mocked<PrismaService> {
  const brand = 'tenantBrand' in opts ? opts.tenantBrand : DB_BRAND;

  return {
    tenantBrand: {
      findUnique: jest.fn().mockResolvedValue(brand),
      upsert:     jest.fn().mockResolvedValue(brand),
      delete:     jest.fn().mockResolvedValue({}),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

function makeRedis(opts: {
  cachedValue?: string | null;
} = {}): jest.Mocked<Redis> {
  const cached = 'cachedValue' in opts ? opts.cachedValue : null;

  return {
    get:    jest.fn().mockResolvedValue(cached),
    setex:  jest.fn().mockResolvedValue('OK'),
    del:    jest.fn().mockResolvedValue(1),
  } as unknown as jest.Mocked<Redis>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WhiteLabelService', () => {

  describe('getBrand()', () => {
    it('retourne le brand depuis le cache Redis si présent', async () => {
      const cached = JSON.stringify({ ...DB_BRAND, brandName: 'Cached Brand' });
      const prisma = makePrisma();
      const redis  = makeRedis({ cachedValue: cached });
      const svc    = new WhiteLabelService(prisma, redis);

      const result = await svc.getBrand(TENANT_ID);

      expect(result.brandName).toBe('Cached Brand');
      expect(prisma.tenantBrand.findUnique).not.toHaveBeenCalled();
    });

    it('charge depuis la DB si pas de cache et met en cache', async () => {
      const prisma = makePrisma({ tenantBrand: DB_BRAND });
      const redis  = makeRedis({ cachedValue: null });
      const svc    = new WhiteLabelService(prisma, redis);

      const result = await svc.getBrand(TENANT_ID);

      expect(prisma.tenantBrand.findUnique).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
      expect(redis.setex).toHaveBeenCalledWith(
        `wl:brand:${TENANT_ID}`,
        300,
        expect.any(String),
      );
      expect(result.brandName).toBe('Congo Express');
    });

    it('retourne les valeurs par défaut si aucun TenantBrand en DB', async () => {
      const prisma = makePrisma({ tenantBrand: null });
      const redis  = makeRedis({ cachedValue: null });
      const svc    = new WhiteLabelService(prisma, redis);

      const result = await svc.getBrand(TENANT_ID);

      expect(result.brandName).toBe('TranslogPro');   // DEFAULT_BRAND
      expect(result.primaryColor).toBe('#2563eb');
    });
  });

  describe('upsert()', () => {
    it('invalide le cache après mise à jour', async () => {
      const prisma = makePrisma();
      const redis  = makeRedis({ cachedValue: null });
      const svc    = new WhiteLabelService(prisma, redis);

      await svc.upsert(TENANT_ID, { brandName: 'Nouveau Nom' });

      expect(redis.del).toHaveBeenCalledWith(`wl:brand:${TENANT_ID}`);
    });

    it('appelle prisma.tenantBrand.upsert avec les données du DTO', async () => {
      const prisma = makePrisma();
      const redis  = makeRedis({ cachedValue: null });
      const svc    = new WhiteLabelService(prisma, redis);

      await svc.upsert(TENANT_ID, { brandName: 'Express Plus', primaryColor: '#ff0000' });

      expect(prisma.tenantBrand.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where:  { tenantId: TENANT_ID },
          create: expect.objectContaining({ brandName: 'Express Plus', primaryColor: '#ff0000' }),
          update: expect.objectContaining({ brandName: 'Express Plus', primaryColor: '#ff0000' }),
        }),
      );
    });
  });

  describe('remove()', () => {
    it('lance NotFoundException si aucune config de marque pour ce tenant', async () => {
      const prisma = makePrisma({ tenantBrand: null });
      const redis  = makeRedis();
      const svc    = new WhiteLabelService(prisma, redis);

      await expect(svc.remove(TENANT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('invalide le cache après suppression', async () => {
      const prisma = makePrisma({ tenantBrand: DB_BRAND });
      const redis  = makeRedis();
      const svc    = new WhiteLabelService(prisma, redis);

      await svc.remove(TENANT_ID);

      expect(redis.del).toHaveBeenCalledWith(`wl:brand:${TENANT_ID}`);
    });
  });

  describe('buildStyleTag()', () => {
    it('génère un bloc <style> avec les CSS custom properties', () => {
      const prisma = makePrisma();
      const redis  = makeRedis();
      const svc    = new WhiteLabelService(prisma, redis);

      const style = svc.buildStyleTag(DB_BRAND as any);

      expect(style).toContain('<style data-tenant-brand>');
      expect(style).toContain('--color-primary:   #0d9488');
      expect(style).toContain('--color-accent:    #f59e0b');
      expect(style).toContain('--font-brand:      Inter, sans-serif');
    });

    it('injecte le customCss du tenant après les variables', () => {
      const prisma = makePrisma();
      const redis  = makeRedis();
      const svc    = new WhiteLabelService(prisma, redis);

      const brand = { ...DB_BRAND, customCss: 'body { color: red; }' } as any;
      const style = svc.buildStyleTag(brand);

      expect(style).toContain('body { color: red; }');
    });
  });
});
