/**
 * PlatformAnalyticsService — métriques cross-tenant (growth / adoption / health).
 *
 * Approche : deux sources
 *   1. Calcul on-the-fly à partir des tables source (Tenant, User, Session,
 *      OutboxEvent, SupportTicket). Performant tant que les volumes restent
 *      modestes (< 100k users). Au-delà, on bascule sur les agrégats cron.
 *   2. Agrégats quotidiens DailyActiveUser / TenantHealthScore, alimentés par
 *      runDailyActiveUsersJob() et runTenantHealthScoreJob() chaque nuit.
 *
 * Aucune valeur métier hardcodée : les plans viennent de Plan, les états et
 * catégories de ticket sont lus tels quels depuis la DB.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PLATFORM_TENANT_ID } from '../../../prisma/seeds/iam.seed';
import { MS_PER_DAY } from '../../common/constants/time';
import { HEALTH_SCORE, ACTIVITY_WINDOWS } from './platform-analytics.constants';

@Injectable()
export class PlatformAnalyticsService {
  private readonly logger = new Logger(PlatformAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PlatformConfigService,
  ) {}

  // ─── Growth (tenants, revenus, churn) ──────────────────────────────────

  async getGrowth() {
    const now       = new Date();
    const startMTD  = new Date(now.getFullYear(), now.getMonth(), 1);
    const start30d  = new Date(now.getTime() - ACTIVITY_WINDOWS.mauDays * MS_PER_DAY);
    const start90d  = new Date(now.getTime() - 90 * MS_PER_DAY);

    const [total, byStatus, byPlan, newThisMonth, cancelled30d, top] = await Promise.all([
      this.prisma.tenant.count({ where: { id: { not: PLATFORM_TENANT_ID } } }),
      this.prisma.tenant.groupBy({
        by:      ['provisionStatus'],
        where:   { id: { not: PLATFORM_TENANT_ID } },
        _count:  { _all: true },
      }),
      this.prisma.platformSubscription.groupBy({
        by:      ['planId', 'status'],
        _count:  { _all: true },
      }),
      this.prisma.tenant.count({
        where: {
          id: { not: PLATFORM_TENANT_ID },
          createdAt: { gte: startMTD },
        },
      }),
      this.prisma.platformSubscription.count({
        where: { status: 'CANCELLED', cancelledAt: { gte: start30d } },
      }),
      // Top tenants par nombre d'utilisateurs actifs
      this.prisma.tenant.findMany({
        where:  { id: { not: PLATFORM_TENANT_ID } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true, name: true, slug: true, country: true, provisionStatus: true,
          planId: true,
          _count: { select: { users: { where: { isActive: true } } } },
        },
      }),
    ]);

    const activeCount = await this.prisma.platformSubscription.count({ where: { status: { in: ['ACTIVE', 'TRIAL'] } } });
    const churnRate = activeCount > 0
      ? cancelled30d / Math.max(1, activeCount + cancelled30d)
      : 0;

    // Chiffre d'affaires potentiel récurrent (MRR-like) à partir des plans
    // actifs — on suppose MONTHLY ou YEARLY/12 pour normaliser.
    const activeSubs = await this.prisma.platformSubscription.findMany({
      where:   { status: { in: ['ACTIVE', 'PAST_DUE'] } },
      include: { plan: { select: { price: true, currency: true, billingCycle: true } } },
    });
    const mrrByCurrency: Record<string, number> = {};
    for (const s of activeSubs) {
      const amount = s.plan.billingCycle === 'YEARLY'
        ? s.plan.price / 12
        : s.plan.billingCycle === 'MONTHLY'
          ? s.plan.price
          : 0;
      mrrByCurrency[s.plan.currency] = (mrrByCurrency[s.plan.currency] ?? 0) + amount;
    }

    return {
      totalTenants:    total,
      byProvisionStatus: byStatus.reduce<Record<string, number>>((acc, r) => {
        acc[r.provisionStatus] = r._count._all; return acc;
      }, {}),
      byPlan:          byPlan,
      newThisMonth,
      cancelled30d,
      churnRate30d:    Number(churnRate.toFixed(4)),
      mrr:             mrrByCurrency,
      topTenants:      top,
      periods: { startMTD, start30d, start90d, now },
    };
  }

  // ─── Adoption (DAU / MAU / modules) ────────────────────────────────────

  async getAdoption() {
    const now      = new Date();
    const start1d  = new Date(now.getTime() - ACTIVITY_WINDOWS.dauDays * MS_PER_DAY);
    const start7d  = new Date(now.getTime() - ACTIVITY_WINDOWS.wauDays * MS_PER_DAY);
    const start30d = new Date(now.getTime() - ACTIVITY_WINDOWS.mauDays * MS_PER_DAY);

    // DAU/WAU/MAU à partir de User.lastActiveAt pour les users non-plateforme.
    const [dau, wau, mau, totalActive] = await Promise.all([
      this.prisma.user.count({
        where: { tenantId: { not: PLATFORM_TENANT_ID }, lastActiveAt: { gte: start1d } },
      }),
      this.prisma.user.count({
        where: { tenantId: { not: PLATFORM_TENANT_ID }, lastActiveAt: { gte: start7d } },
      }),
      this.prisma.user.count({
        where: { tenantId: { not: PLATFORM_TENANT_ID }, lastActiveAt: { gte: start30d } },
      }),
      this.prisma.user.count({
        where: { tenantId: { not: PLATFORM_TENANT_ID }, isActive: true },
      }),
    ]);

    // Adoption par module : nombre de tenants qui ont installedModule.isActive
    // = true pour chaque moduleKey rencontré.
    const modules = await this.prisma.installedModule.groupBy({
      by:     ['moduleKey'],
      where:  { tenantId: { not: PLATFORM_TENANT_ID }, isActive: true },
      _count: { tenantId: true },
    });
    const totalTenants = await this.prisma.tenant.count({ where: { id: { not: PLATFORM_TENANT_ID } } });
    const moduleAdoption = modules.map(m => ({
      moduleKey: m.moduleKey,
      tenants:   m._count.tenantId,
      pct:       totalTenants > 0 ? Number((m._count.tenantId / totalTenants).toFixed(4)) : 0,
    }));

    // Trend DAU sur les 30 derniers jours depuis l'agrégat DailyActiveUser.
    const rows = await this.prisma.dailyActiveUser.groupBy({
      by:     ['date'],
      where:  { date: { gte: start30d } },
      _count: { userId: true },
      orderBy: { date: 'asc' },
    });
    const trend = rows.map(r => ({ date: r.date, count: r._count.userId }));

    return {
      dau,
      wau,
      mau,
      totalActiveUsers: totalActive,
      moduleAdoption,
      trend30d: trend,
      periods: { start1d, start7d, start30d, now },
    };
  }

  // ─── Health (tenants à risque, DLQ, incidents, support) ────────────────

  async getHealth() {
    const today = startOfUtcDay(new Date());
    // Seuil DB-driven (config plateforme) ; fallback sur la constante.
    const threshold = await this.config.getNumber('health.riskThreshold')
      .catch(() => HEALTH_SCORE.riskThreshold);

    const [latest, dlq, openTickets, openIncidents, impersonationsOpen] = await Promise.all([
      // Dernier score par tenant (si agrégat calculé)
      this.prisma.tenantHealthScore.findMany({
        where:   { date: { lte: today } },
        orderBy: [{ tenantId: 'asc' }, { date: 'desc' }],
        distinct: ['tenantId'],
      }),
      this.prisma.deadLetterEvent.count({ where: { resolvedAt: null } }),
      this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.incident.count({ where: { resolvedAt: null } }),
      this.prisma.impersonationSession.count({
        where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
      }),
    ]);

    const atRisk = latest
      .filter(s => s.score < threshold)
      .map(s => ({ tenantId: s.tenantId, score: s.score, date: s.date, components: s.components }));

    const avgScore = latest.length > 0
      ? Math.round(latest.reduce((acc, s) => acc + s.score, 0) / latest.length)
      : null;

    return {
      avgHealthScore:        avgScore,
      atRiskTenants:         atRisk,
      dlqOpen:               dlq,
      supportTicketsOpen:    openTickets,
      incidentsOpen:         openIncidents,
      impersonationsActive:  impersonationsOpen,
      lastComputedAt:        today,
    };
  }

  // ─── Focus tenant (vue détaillée pour le support) ──────────────────────

  async getTenantOverview(tenantId: string) {
    const now = new Date();
    const start30d = new Date(now.getTime() - 30 * MS_PER_DAY);

    const [tenant, sub, users, dau, mau, openTickets, incidents, dlq, lastScore] = await Promise.all([
      this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        include: { plan: true, subscription: true },
      }),
      this.prisma.platformSubscription.findUnique({ where: { tenantId } }),
      this.prisma.user.count({ where: { tenantId, isActive: true } }),
      this.prisma.user.count({
        where: { tenantId, lastActiveAt: { gte: new Date(now.getTime() - MS_PER_DAY) } },
      }),
      this.prisma.user.count({
        where: { tenantId, lastActiveAt: { gte: start30d } },
      }),
      this.prisma.supportTicket.count({ where: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.incident.count({ where: { tenantId, resolvedAt: null } }),
      this.prisma.deadLetterEvent.count({ where: { tenantId, resolvedAt: null } }),
      this.prisma.tenantHealthScore.findFirst({ where: { tenantId }, orderBy: { date: 'desc' } }),
    ]);

    return {
      tenant,
      subscription: sub,
      users: { total: users, dau, mau },
      supportTicketsOpen: openTickets,
      incidentsOpen: incidents,
      dlqOpen: dlq,
      healthScore: lastScore ?? null,
    };
  }

  // ─── CRONS : agrégats nocturnes ────────────────────────────────────────

  /**
   * 02:00 UTC — calcul DailyActiveUser pour J-1.
   * Source : users avec lastActiveAt dans la fenêtre [00:00, 24:00) de J-1.
   *
   * SÉCURITÉ CROSS-TENANT : ce cron parcourt explicitement tous les tenants
   * en une seule transaction. Chaque upsert porte son `tenantId` (pris de
   * `u.tenantId`), donc chaque INSERT est tenant-scoped par construction.
   * RLS PG n'est pas actif ici (pas de request context), mais le filtre est
   * appliqué côté query — invariant : NE JAMAIS ajouter une query sans
   * `tenantId` dans ce cron sans wrapper `withTenant`.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runDailyActiveUsersJob(): Promise<void> {
    const now       = new Date();
    const yStart    = startOfUtcDay(new Date(now.getTime() - MS_PER_DAY));
    const yEnd      = new Date(yStart.getTime() + MS_PER_DAY);

    // On lit les users actifs (utilisateurs non plateforme, activité hier).
    // Batch simple — OK pour ~100k users max.
    const users = await this.prisma.user.findMany({
      where: {
        tenantId:     { not: PLATFORM_TENANT_ID },
        lastActiveAt: { gte: yStart, lt: yEnd },
      },
      select: { id: true, tenantId: true },
    });

    if (users.length === 0) {
      this.logger.log(`[DAU cron] aucun user actif pour ${yStart.toISOString().slice(0, 10)}`);
      return;
    }

    await this.prisma.$transaction(
      users.map(u => this.prisma.dailyActiveUser.upsert({
        where:  { userId_date: { userId: u.id, date: yStart } },
        update: { sessionsCount: { increment: 0 } },
        create: { userId: u.id, tenantId: u.tenantId, date: yStart, sessionsCount: 1 },
      })),
    );
    this.logger.log(`[DAU cron] ${users.length} rows upsert for ${yStart.toISOString().slice(0, 10)}`);
  }

  /**
   * 02:30 UTC — calcul TenantHealthScore pour J.
   * Composantes (poids cumul 100) :
   *   - 40 Uptime  (1 - incidents ouverts / 10, clampé 0-1)
   *   - 20 Support (1 - tickets en attente / 5, clampé)
   *   - 20 DLQ    (1 si 0 DLQ ouvert, dégradation linéaire)
   *   - 20 Engagement (MAU / users actifs)
   */
  @Cron('30 2 * * *')
  async runTenantHealthScoreJob(): Promise<void> {
    const today = startOfUtcDay(new Date());
    const start30d = new Date(today.getTime() - 30 * MS_PER_DAY);

    const tenants = await this.prisma.tenant.findMany({
      where:  { id: { not: PLATFORM_TENANT_ID }, isActive: true },
      select: { id: true, slug: true },
    });

    // Seuils DB-driven (fallback const si absents / indisponibles).
    const [thIncidents, thTickets, thDlq] = await Promise.all([
      this.config.getNumber('health.thresholds.incidents').catch(() => HEALTH_SCORE.thresholds.incidents),
      this.config.getNumber('health.thresholds.tickets'  ).catch(() => HEALTH_SCORE.thresholds.tickets),
      this.config.getNumber('health.thresholds.dlqEvents').catch(() => HEALTH_SCORE.thresholds.dlqEvents),
    ]);

    for (const t of tenants) {
      try {
        // Defense in depth : wrap per-tenant body dans withTenant → RLS PG
        // applique app.tenant_id=t.id pour cette itération, en plus des
        // filtres explicites tenantId: t.id dans chaque query.
        // Si un futur refactor oublie le filter, RLS bloque quand même.
        await this.prisma.withTenant(t.id, async (tx) => {
          const [incidentsOpen, ticketsOpen, dlqOpen, mau, activeUsers] = await Promise.all([
            tx.incident.count({ where: { tenantId: t.id, resolvedAt: null } }),
            tx.supportTicket.count({ where: { tenantId: t.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
            tx.deadLetterEvent.count({ where: { tenantId: t.id, resolvedAt: null } }),
            tx.user.count({ where: { tenantId: t.id, lastActiveAt: { gte: start30d } } }),
            tx.user.count({ where: { tenantId: t.id, isActive: true } }),
          ]);

          const uptimeComp   = clamp01(1 - incidentsOpen / thIncidents) * HEALTH_SCORE.weights.uptime;
          const supportComp  = clamp01(1 - ticketsOpen   / thTickets  ) * HEALTH_SCORE.weights.support;
          const dlqComp      = clamp01(1 - dlqOpen       / thDlq      ) * HEALTH_SCORE.weights.dlq;
          const engageComp   = (activeUsers > 0 ? clamp01(mau / activeUsers) : 0) * HEALTH_SCORE.weights.engagement;
          const score        = Math.round(uptimeComp + supportComp + dlqComp + engageComp);

          await tx.tenantHealthScore.upsert({
            where:  { tenantId_date: { tenantId: t.id, date: today } },
            update: {
              score,
              components: { uptimeComp, supportComp, dlqComp, engageComp, incidentsOpen, ticketsOpen, dlqOpen, mau, activeUsers } as object,
            },
            create: {
              tenantId: t.id, date: today, score,
              components: { uptimeComp, supportComp, dlqComp, engageComp, incidentsOpen, ticketsOpen, dlqOpen, mau, activeUsers } as object,
            },
          });
        });
      } catch (e) {
        this.logger.error(`[Health cron] échec tenant=${t.slug}`, e as Error);
      }
    }
    this.logger.log(`[Health cron] ${tenants.length} tenants scorés ${today.toISOString().slice(0, 10)}`);
  }
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function startOfUtcDay(d: Date): Date {
  const r = new Date(d);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}
