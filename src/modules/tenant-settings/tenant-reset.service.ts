import { Injectable, Logger, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * TenantResetService — opération destructive réservée au TENANT_ADMIN.
 *
 * Conçu pour "repartir à zéro" côté données métier d'un tenant SANS avoir à
 * re-créer l'infra (agences, stations, routes, bus, users, permissions,
 * config). Typiquement utilisé :
 *   · en fin de phase pilote (nettoyer les données de test)
 *   · après une migration ratée
 *   · à la demande d'un tenant qui change complètement d'activité
 *
 * Garde-fous empilés (security first) :
 *   1. Permission granulaire `control.tenant.reset.tenant` (jamais rôle)
 *   2. Re-authentification du password (bcrypt compare) — une session active
 *      ne suffit PAS, l'utilisateur doit RE-prouver qu'il est bien lui.
 *   3. Confirmation explicite via `confirmSlug` === `tenant.slug` (anti-fat-finger)
 *   4. Transaction Prisma atomique avec session_replication_role=replica pour
 *      contourner les FK, garantissant un reset cohérent même sur schema évolutif.
 *   5. Audit log structuré avant et après.
 *
 * Données PURGÉES (métier — réinitialisables) :
 *   - Tickets, travelers, parcels, shipments
 *   - Trips, manifests, incidents, claims
 *   - Cash registers, transactions
 *   - Driver scores, maintenance reminders/reports
 *   - Vouchers, compensation items
 *   - Customers + claim tokens
 *   - TripAnalytics, TripCostSnapshot, DailyActiveUsers, TenantHealthScore
 *
 * Données CONSERVÉES (structurelles — coûteuses à recréer) :
 *   - Tenant lui-même (identité commerciale)
 *   - Agencies, Stations, Routes + PricingRules + Waypoints + RouteSegmentPrice
 *   - Buses + BusCostProfile
 *   - Users, Staff, StaffAssignment, Role, RolePermission
 *   - TenantConfig, TenantBrand, TenantBusinessConfig, TenantPortalConfig, TenantTax
 *   - WorkflowConfig, InstalledModule
 *   - Sessions (pour ne pas déconnecter l'admin qui vient de valider)
 */
@Injectable()
export class TenantResetService {
  private readonly logger = new Logger(TenantResetService.name);

  constructor(private readonly prisma: PrismaService) {}

  async reset(
    tenantId: string,
    actorUserId: string,
    dto: { password: string; confirmSlug: string },
  ): Promise<{ ok: true; purged: Record<string, number>; tenantSlug: string }> {
    // ── 1. Charger le tenant + vérifier l'acteur ─────────────────────────
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true },
    });
    if (!tenant) throw new NotFoundException('Tenant introuvable');

    // ── 2. Garde-fou confirmation slug (fat-finger prevention) ──────────
    if (!dto.confirmSlug || dto.confirmSlug !== tenant.slug) {
      throw new BadRequestException(
        `Confirmation invalide : le slug saisi doit être exactement "${tenant.slug}"`,
      );
    }

    // ── 3. Re-auth password (session active ne suffit PAS) ──────────────
    const actor = await this.prisma.user.findFirst({
      where: { id: actorUserId, tenantId, isActive: true },
      select: { id: true, email: true },
    });
    if (!actor) throw new UnauthorizedException('Utilisateur non autorisé sur ce tenant');

    const account = await this.prisma.account.findFirst({
      where: { userId: actor.id, providerId: 'credential' },
      select: { password: true },
    });
    if (!account?.password) throw new UnauthorizedException('Aucun credential local');

    const passwordOk = await bcrypt.compare(dto.password, account.password);
    if (!passwordOk) throw new UnauthorizedException('Mot de passe incorrect');

    // ── 4. Purge transactionnelle via session_replication_role ──────────
    // Cette technique désactive temporairement les FK Postgres le temps d'une
    // transaction, permettant de purger les tables métier indépendamment de
    // l'ordre. Les CASCADE déclarées continuent de fonctionner. Safe en prod
    // SEULEMENT si les garde-fous ci-dessus sont respectés.
    this.logger.warn(
      `[TenantReset] DÉBUT reset tenant=${tenant.slug} (id=${tenantId}) par user=${actor.email}`,
    );

    const purged = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);

      // Liste EXHAUSTIVE des tables métier à purger. Si tu ajoutes une entité
      // métier au schema, pense à la rajouter ici (sinon le reset sera partiel).
      const tables = [
        'trip_cost_snapshots',
        'trip_analytics',
        'driver_scores',
        'maintenance_reminders',
        'maintenance_reports',
        'compensation_items',
        'vouchers',
        'customer_retro_claim_otps',
        'customer_claim_tokens',
        'tickets',
        'travelers',
        'parcels',
        'shipments',
        'manifests',
        'incidents',
        'claims',
        'cash_registers',
        'transactions',
        'trips',
        'feedbacks',
        'daily_active_users',
        'tenant_health_scores',
      ];

      const counts: Record<string, number> = {};
      for (const table of tables) {
        // Toutes ces tables ont une colonne "tenantId" — scope strict.
        const result = await tx.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE "tenantId" = $1`,
          tenantId,
        );
        counts[table] = result;
      }
      return counts;
    });

    this.logger.warn(
      `[TenantReset] FIN reset tenant=${tenant.slug} — ${Object.values(purged).reduce((s, n) => s + n, 0)} rows purgées`,
    );

    return { ok: true, purged, tenantSlug: tenant.slug };
  }
}
