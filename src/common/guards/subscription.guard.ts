/**
 * SubscriptionGuard — vérifie le statut d'abonnement avant le RBAC.
 *
 * Appliqué globalement (voir app.module.ts APP_GUARD). Doit être déclaré
 * AVANT PermissionGuard dans le tableau de providers pour être exécuté en premier.
 *
 * Comportement par état :
 *   TRIAL / GRACE_PERIOD / ACTIVE / PAST_DUE → accès complet
 *   SUSPENDED → seules les routes whitelistées sont accessibles (paiement, billing, RGPD, auth)
 *   CANCELLED → idem SUSPENDED + export RGPD
 *   CHURNED   → 403 systématique (données supprimées)
 *
 * Routes toujours accessibles (tenant platform, auth, public) :
 *   - Tenant plateforme (00000000-...) : jamais bloqué
 *   - Routes sans tenantId dans le JWT (non connecté) : non bloqué ici
 *   - Routes préfixées /api/auth/*
 *   - Routes préfixées /api/subscription/* (paiement, auto-renew, cancel, resume)
 *   - Routes préfixées /api/backup/gdpr (export RGPD)
 *
 * Cache Redis TTL 60s : on ne tape pas la DB à chaque requête.
 */
import {
  CanActivate, ExecutionContext, ForbiddenException,
  Inject, Injectable, Logger,
} from '@nestjs/common';
import { Reflector }    from '@nestjs/core';
import { Redis }        from 'ioredis';
import { Request }      from 'express';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { REDIS_CLIENT }  from '../../infrastructure/eventbus/redis-publisher.service';
import { SetMetadata }   from '@nestjs/common';

export const SKIP_SUBSCRIPTION_GUARD = 'SKIP_SUBSCRIPTION_GUARD';
export const SkipSubscriptionGuard = () => SetMetadata(SKIP_SUBSCRIPTION_GUARD, true);

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const CACHE_TTL_SECONDS  = 60;

// Préfixes de routes accessibles même en SUSPENDED/CANCELLED
const SUSPENDED_ALLOWED_PREFIXES = [
  '/api/auth',
  '/api/subscription',
  '/api/backup/gdpr',
  '/health',
  '/api/platform',  // SA accès toujours
];

@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly log = new Logger(SubscriptionGuard.name);

  constructor(
    private readonly prisma:    PrismaService,
    @Inject(REDIS_CLIENT)
    private readonly redis:     Redis,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SUBSCRIPTION_GUARD, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: { tenantId?: string } }>();
    const tenantId = req.user?.tenantId;

    // Pas de JWT / pas de tenantId → laisser passer (l'AuthGuard gèrera)
    if (!tenantId) return true;

    // Tenant plateforme → toujours autorisé
    if (tenantId === PLATFORM_TENANT_ID) return true;

    const status = await this.getStatus(tenantId);

    if (status === 'CHURNED') {
      throw new ForbiddenException({
        code:    'SUBSCRIPTION_CHURNED',
        message: 'Ce compte a été résilié. Vos données ont été supprimées.',
      });
    }

    if (status === 'SUSPENDED' || status === 'CANCELLED') {
      const path = req.path ?? '';
      const allowed = SUSPENDED_ALLOWED_PREFIXES.some(p => path.startsWith(p));
      if (!allowed) {
        throw new ForbiddenException({
          code:           'SUBSCRIPTION_SUSPENDED',
          subscriptionStatus: status,
          message:        'Votre abonnement est suspendu. Veuillez régler votre facture pour continuer.',
        });
      }
    }

    return true;
  }

  private async getStatus(tenantId: string): Promise<string> {
    const cacheKey = `sub:status:${tenantId}`;
    const cached   = await this.redis.get(cacheKey);
    if (cached) return cached;

    const sub = await this.prisma.platformSubscription.findUnique({
      where:  { tenantId },
      select: { status: true },
    });
    const status = sub?.status ?? 'TRIAL';

    await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, status);
    return status;
  }
}
