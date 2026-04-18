/**
 * PlatformConfigService — lecture/écriture du KV store plateforme.
 *
 * Cache in-memory TTL 60 s (pas de Redis — volume < 20 clés, faible fréquence).
 * Le cache est invalidé automatiquement sur toute écriture via `set`.
 *
 * Tous les consommateurs (analytics, billing, support) doivent passer par
 * ce service via `getNumber / getBoolean / getString`. Le fallback sur le
 * `default` du registre garantit que l'app fonctionne même si la DB est
 * vide ou si la table PlatformConfig est temporairement indisponible.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  PLATFORM_CONFIG_REGISTRY,
  PlatformConfigDef,
  findDef,
} from './platform-config.registry';

const CACHE_TTL_MS = 60_000;

interface CacheEntry { value: unknown; expiresAt: number }

@Injectable()
export class PlatformConfigService {
  private readonly logger = new Logger(PlatformConfigService.name);
  private readonly cache  = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  // ─── Lecture typée (appels internes services) ───────────────────────────

  async getNumber(key: string): Promise<number> {
    const def = findDef(key);
    if (!def || def.type !== 'number') {
      throw new Error(`PlatformConfig key "${key}" is not registered as number`);
    }
    const v = await this.readWithFallback(key, def);
    return Number(v);
  }

  async getBoolean(key: string): Promise<boolean> {
    const def = findDef(key);
    if (!def || def.type !== 'boolean') {
      throw new Error(`PlatformConfig key "${key}" is not registered as boolean`);
    }
    const v = await this.readWithFallback(key, def);
    return Boolean(v);
  }

  async getString(key: string): Promise<string> {
    const def = findDef(key);
    if (!def || def.type !== 'string') {
      throw new Error(`PlatformConfig key "${key}" is not registered as string`);
    }
    const v = await this.readWithFallback(key, def);
    return String(v);
  }

  // ─── Lecture "brute" (UI admin) ─────────────────────────────────────────

  /**
   * Retourne le registre complet enrichi des valeurs courantes (DB ou default).
   * Utilisé par PagePlatformSettings pour afficher le formulaire.
   */
  async getAll(): Promise<Array<PlatformConfigDef<unknown> & { current: unknown; isDefault: boolean }>> {
    const rows = await this.prisma.platformConfig.findMany();
    const byKey = new Map(rows.map(r => [r.key, r.value]));
    return PLATFORM_CONFIG_REGISTRY.map(def => {
      const v = byKey.get(def.key);
      return { ...def, current: v ?? def.default, isDefault: v === undefined };
    });
  }

  // ─── Écriture (SA seulement, check @RequirePermission côté controller) ──

  async set(key: string, value: unknown, actorId: string | null): Promise<void> {
    const def = findDef(key);
    if (!def) throw new NotFoundException(`Clé "${key}" inconnue`);
    // Coercion & validation
    const coerced = this.coerce(value, def.type);
    if (coerced === null) throw new BadRequestException(`Type invalide pour "${key}"`);
    const err = def.validate?.(coerced);
    if (err) throw new BadRequestException(err);

    await this.prisma.platformConfig.upsert({
      where:  { key },
      update: { value: coerced as object, updatedBy: actorId },
      create: { key, value: coerced as object, updatedBy: actorId },
    });

    this.invalidate(key);
    this.logger.log(`[PlatformConfig] ${key} = ${JSON.stringify(coerced)} (by ${actorId ?? 'system'})`);
  }

  async setBatch(entries: Array<{ key: string; value: unknown }>, actorId: string | null): Promise<void> {
    // Validation préalable de toutes les entrées avant d'écrire une seule.
    const prepared: Array<{ key: string; value: unknown }> = [];
    for (const e of entries) {
      const def = findDef(e.key);
      if (!def) throw new NotFoundException(`Clé "${e.key}" inconnue`);
      const coerced = this.coerce(e.value, def.type);
      if (coerced === null) throw new BadRequestException(`Type invalide pour "${e.key}"`);
      const err = def.validate?.(coerced);
      if (err) throw new BadRequestException(`${e.key}: ${err}`);
      prepared.push({ key: e.key, value: coerced });
    }
    await this.prisma.$transaction(
      prepared.map(p => this.prisma.platformConfig.upsert({
        where:  { key: p.key },
        update: { value: p.value as object, updatedBy: actorId },
        create: { key: p.key, value: p.value as object, updatedBy: actorId },
      })),
    );
    for (const p of prepared) this.invalidate(p.key);
  }

  /** Remet la clé à sa valeur par défaut (suppression de la ligne DB). */
  async reset(key: string): Promise<void> {
    const def = findDef(key);
    if (!def) throw new NotFoundException(`Clé "${key}" inconnue`);
    await this.prisma.platformConfig.deleteMany({ where: { key } });
    this.invalidate(key);
  }

  // ─── Internes ────────────────────────────────────────────────────────────

  private async readWithFallback(key: string, def: PlatformConfigDef<unknown>): Promise<unknown> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    try {
      const row = await this.prisma.platformConfig.findUnique({ where: { key } });
      const value = row?.value ?? def.default;
      this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    } catch (e) {
      // DB indisponible : on retombe sur le default (pas de panique).
      this.logger.warn(`[PlatformConfig] DB unreachable for "${key}", using default`, e as Error);
      return def.default;
    }
  }

  private invalidate(key: string): void {
    this.cache.delete(key);
  }

  private coerce(value: unknown, type: PlatformConfigDef<unknown>['type']): unknown | null {
    if (type === 'number') {
      const n = typeof value === 'string' ? Number(value) : value;
      return typeof n === 'number' && Number.isFinite(n) ? n : null;
    }
    if (type === 'boolean') {
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 1)  return true;
      if (value === 'false' || value === 0) return false;
      return null;
    }
    if (type === 'string') {
      return typeof value === 'string' ? value : null;
    }
    return null;
  }
}
