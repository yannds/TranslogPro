/**
 * IamBootstrapService — synchronise les rôles SYSTEM de TOUS les tenants
 * depuis la source de vérité TypeScript (`TENANT_ROLES` dans iam.seed.ts)
 * au démarrage de l'application.
 *
 * Problème résolu : en SaaS multi-tenant, ajouter une permission à un rôle
 * système (ex. `data.fleet.status.agency` au TENANT_ADMIN) dans le seed TS
 * ne suffit pas — il faut propager le changement dans toutes les DB tenants
 * existantes. Sans ce service, il fallait rejouer `npm run db:seed`
 * manuellement ou chaque admin tenant voyait des 403 jusqu'au prochain
 * redéploiement + seed manuel.
 *
 * Comportement :
 *   1. À `onApplicationBootstrap` (après init Nest, avant accepter trafic) :
 *   2. Scan tous les tenants non-plateforme.
 *   3. Pour chaque rôle `isSystem=true` : ajoute les perms manquantes,
 *      retire les perms en trop (sync strict depuis le seed).
 *   4. Invalide le cache Redis `iam:perm:*` pour forcer relecture par
 *      PermissionGuard au prochain hit (évite 403 stale).
 *   5. Log le rapport (tenants scannés, perms ajoutées/retirées).
 *
 * Rôles custom (isSystem=false) jamais touchés — seules les définitions
 * système officielles sont rejouées.
 *
 * Opt-out : variable env `SKIP_IAM_RECONCILE=true` pour désactiver (utile
 * pour debug local / fixtures test). Opt-in par défaut sinon.
 */
import { Injectable, Logger, OnApplicationBootstrap, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  reconcileSystemRolePermissions,
  backfillStaffFromUsers,
} from '../../../../prisma/seeds/iam.seed';
import { REDIS_CLIENT } from '../../../infrastructure/eventbus/redis-publisher.service';
import type Redis from 'ioredis';

@Injectable()
export class IamBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IamBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.SKIP_IAM_RECONCILE === 'true') {
      this.logger.log('[IamBootstrap] SKIP_IAM_RECONCILE=true — reconcile skipped');
      return;
    }
    if (process.env.NODE_ENV === 'test') {
      // En mode test (jest e2e/integration), le seed gère déjà les rôles —
      // éviter double travail + éviter flush Redis partagé.
      return;
    }

    const startedAt = Date.now();
    try {
      // 1. Reconciliation rôles système (perms ajoutées/retirées vs seed TS)
      const permReport = await reconcileSystemRolePermissions(this.prisma);

      if (permReport.rolesTouched === 0) {
        this.logger.log(
          `[IamBootstrap] perms — ${permReport.tenants} tenant(s) scanné(s), 0 drift`,
        );
      } else {
        this.logger.warn(
          `[IamBootstrap] perms — ${permReport.tenants} tenant(s), ` +
          `${permReport.rolesTouched} rôle(s) mis à jour : ` +
          `+${permReport.permsAdded} / -${permReport.permsRemoved}. Flush Redis iam:perm:*`,
        );
        await this.flushPermissionCache();
      }

      // 2. Backfill Staff depuis Users (intégrité 1:1 — drivers voient leurs
      //    trajets, admin voit son équipe, crew_assignments restent valides).
      const staffReport = await backfillStaffFromUsers(this.prisma);
      if (staffReport.staffCreated === 0) {
        this.logger.log(
          `[IamBootstrap] staff — ${staffReport.usersScanned} user(s) STAFF, 0 Staff manquant`,
        );
      } else {
        this.logger.warn(
          `[IamBootstrap] staff — ${staffReport.usersScanned} user(s) STAFF scanné(s), ` +
          `${staffReport.staffCreated} Staff row(s) recréé(s) (backfill intégrité)`,
        );
      }

      const durationMs = Date.now() - startedAt;
      this.logger.log(`[IamBootstrap] ready in ${durationMs}ms`);
    } catch (err) {
      // Ne JAMAIS bloquer le boot sur un souci de reconcile. Log + continue.
      this.logger.error(
        `[IamBootstrap] échec reconcile : ${(err as Error).message}. ` +
        `Le serveur démarre quand même — corrigez manuellement via \`npm run db:seed\`.`,
        (err as Error).stack,
      );
    }
  }

  /**
   * Vide les entrées `iam:perm:*` du cache Redis. Ne supprime rien d'autre.
   * Utilise SCAN (O(N) non-bloquant) plutôt que KEYS (O(N) bloquant) pour
   * rester SaaS-safe même sur des Redis avec des millions de clés.
   */
  private async flushPermissionCache(): Promise<void> {
    if (!this.redis) {
      this.logger.debug('[IamBootstrap] Redis non injecté — skip flush cache');
      return;
    }
    try {
      const pattern = 'iam:perm:*';
      const stream = this.redis.scanStream({ match: pattern, count: 200 });
      let deleted = 0;
      for await (const keys of stream) {
        if (Array.isArray(keys) && keys.length > 0) {
          await this.redis.del(...(keys as string[]));
          deleted += keys.length;
        }
      }
      this.logger.log(`[IamBootstrap] Redis cache ${pattern} flushed — ${deleted} entrée(s) supprimée(s)`);
    } catch (err) {
      this.logger.warn(
        `[IamBootstrap] flush Redis échoué : ${(err as Error).message}. ` +
        `Les perms prendront effet après le TTL naturel (60s).`,
      );
    }
  }
}
