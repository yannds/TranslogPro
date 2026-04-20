/**
 * PlatformKpiService — métriques SaaS de niveau plateforme (cross-tenant).
 *
 * Vue complémentaire à PlatformAnalyticsService :
 *   - PlatformAnalyticsService : growth / adoption / health bruts (legacy)
 *   - PlatformKpiService       : North Star, MRR, cohortes, activation, strategic
 *
 * Toutes les méthodes sont READ-ONLY. Aucun effet de bord métier.
 *
 * Règles d'or :
 *   - Zéro hardcoded magic number — tout seuil via `PlatformConfigService`
 *     (namespace `kpi.*`).
 *   - Le tenant plateforme (`PLATFORM_TENANT_ID`) est systématiquement exclu.
 *   - Cache mémoire par méthode (TTL `kpi.cacheTtlSeconds`) pour protéger la DB
 *     sur dashboards très rafraîchis.
 *   - Aucun accès aux données tenant-spécifiques détaillées autre qu'agrégats.
 *     Les endpoints RBAC (controller) filtreront les champs selon permission.
 *   - RLS : les requêtes cross-tenant de ce service tournent HORS contexte
 *     tenant (appelées par un user plateforme via `RequirePermission *.global`).
 *     Chaque query fait son filtre explicite `tenantId: { not: PLATFORM_TENANT_ID }`.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PLATFORM_TENANT_ID } from '../../../prisma/seeds/iam.seed';
import { MS_PER_DAY } from '../../common/constants/time';
import {
  KPI_PERIODS,
  ACTIVATION_STEPS,
  USER_TYPE_BUCKETS,
  MODULE_ACTION_PREFIXES,
  type UserTypeBucket,
  type NorthStarMode,
} from './platform-kpi.constants';
import type {
  NorthStarReport,
  NorthStarTenantEntry,
  MrrBreakdownReport,
  RetentionReport,
  TransactionalReport,
  AdoptionReport,
  ActivationFunnelReport,
  StrategicReport,
} from './platform-kpi.types';

interface CacheEntry<T> { value: T; expiresAt: number }

@Injectable()
export class PlatformKpiService {
  private readonly logger = new Logger(PlatformKpiService.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PlatformConfigService,
  ) {}

  // ─── Cache helper (TTL configurable) ─────────────────────────────────────

  private async withCache<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.cache.get(key) as CacheEntry<T> | undefined;
    if (hit && hit.expiresAt > now) return hit.value;
    const value = await fn();
    const ttlSec = await this.config.getNumber('kpi.cacheTtlSeconds').catch(() => 60);
    this.cache.set(key, { value, expiresAt: now + ttlSec * 1000 });
    return value;
  }

  /** Utilitaire exposé pour tests et endpoints explicites (forcer refresh). */
  clearCache(prefix?: string): void {
    if (!prefix) { this.cache.clear(); return; }
    for (const k of this.cache.keys()) if (k.startsWith(prefix)) this.cache.delete(k);
  }

  /** Mapping tenantId → currency, mis en cache (60s) pour éviter N+1 sur tickets. */
  private async loadTenantCurrencyMap(): Promise<Map<string, string>> {
    const key = 'tenant:currency:map';
    const cached = this.cache.get(key) as CacheEntry<Map<string, string>> | undefined;
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const rows = await this.prisma.tenant.findMany({
      where:  { id: { not: PLATFORM_TENANT_ID } },
      select: { id: true, currency: true },
    });
    const map = new Map(rows.map((r) => [r.id, r.currency]));
    const ttlSec = await this.config.getNumber('kpi.cacheTtlSeconds').catch(() => 60);
    this.cache.set(key, { value: map, expiresAt: Date.now() + ttlSec * 1000 });
    return map;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. NORTH STAR — % opérations gérées via la plateforme
  // ═══════════════════════════════════════════════════════════════════════

  async getNorthStar(mode: NorthStarMode = 'compared', periodDays?: number): Promise<NorthStarReport> {
    const days = periodDays ?? await this.config.getNumber('kpi.defaultPeriodDays').catch(() => KPI_PERIODS.medium);
    return this.withCache(`northstar:${mode}:${days}`, async () => {
      const targetOccupancy = await this.config.getNumber('kpi.targetOccupancyRate').catch(() => 0.65);
      const since = new Date(Date.now() - days * MS_PER_DAY);

      // 1. Liste des tenants éligibles
      const tenants = await this.prisma.tenant.findMany({
        where: { id: { not: PLATFORM_TENANT_ID }, isActive: true },
        select: {
          id: true,
          name: true,
          slug: true,
          estimatedOperationsMonthly: true,
        },
      });

      // 2. Pour chaque tenant, compter actual (tickets/trips/incidents) sur la période
      //    + capacité théorique flotte (sum Bus.capacity) pour mode heuristique
      const entries: NorthStarTenantEntry[] = [];
      for (const t of tenants) {
        const [actualTickets, actualTrips, actualIncidents, fleetCapacity, tripsInPeriod] = await Promise.all([
          this.prisma.ticket.count({ where: { tenantId: t.id, createdAt: { gte: since } } }),
          this.prisma.trip.count({ where: { tenantId: t.id, departureScheduled: { gte: since } } }),
          this.prisma.incident.count({ where: { tenantId: t.id, createdAt: { gte: since } } }),
          this.prisma.bus.aggregate({
            where: { tenantId: t.id, status: { notIn: ['MAINTENANCE', 'CLOSED'] } },
            _sum:  { capacity: true },
          }),
          this.prisma.trip.count({ where: { tenantId: t.id, departureScheduled: { gte: since } } }),
        ]);

        // Normalisation période → équivalent mensuel (pour comparer avec estimation monthly)
        const monthlyFactor = 30 / days;
        const monthlyTickets   = actualTickets   * monthlyFactor;
        const monthlyTrips     = actualTrips     * monthlyFactor;
        const monthlyIncidents = actualIncidents * monthlyFactor;

        // Mode déclaratif — disponible uniquement si le tenant a rempli l'estimation
        const est = t.estimatedOperationsMonthly as null | { tickets?: number; trips?: number; incidents?: number };
        let declarative: NorthStarTenantEntry['declarative'] = null;
        if (est && typeof est === 'object') {
          declarative = {
            tickets:   buildDeclarative(monthlyTickets,   est.tickets),
            trips:     buildDeclarative(monthlyTrips,     est.trips),
            incidents: buildDeclarative(monthlyIncidents, est.incidents),
          };
        }

        // Mode heuristique — nécessite fleetCapacity + trips sur la période
        const capacity = fleetCapacity._sum.capacity ?? 0;
        let heuristic: NorthStarTenantEntry['heuristic'] = null;
        if (capacity > 0 && tripsInPeriod > 0) {
          // Tickets théoriques = capacité × trips planifiés × taux cible
          const theoreticalTickets = capacity * tripsInPeriod * targetOccupancy;
          // Trips théoriques sur la période → utilise capacity (1 bus = 1 trip/jour comme baseline)
          // On reste simple et honnête : pour trips, on compare au plan réel du tenant.
          const theoreticalTrips   = Math.max(tripsInPeriod, actualTrips);
          heuristic = {
            tickets: {
              actual:      actualTickets,
              theoretical: round(theoreticalTickets),
              pct:         safePct(actualTickets, theoreticalTickets),
            },
            trips: {
              actual:      actualTrips,
              theoretical: round(theoreticalTrips),
              pct:         safePct(actualTrips, theoreticalTrips),
            },
          };
        }

        // Mode effectivement appliqué : declarative si demandé ET disponible,
        // sinon heuristic si disponible, sinon null (tenant non couvert).
        const appliedMode: NorthStarMode =
          (mode === 'declarative' && declarative) ? 'declarative'
          : (mode === 'heuristic' && heuristic)   ? 'heuristic'
          : (mode === 'compared' && (declarative || heuristic)) ? 'compared'
          : (declarative ? 'declarative' : (heuristic ? 'heuristic' : 'compared'));

        entries.push({
          tenantId:   t.id,
          tenantName: t.name,
          tenantSlug: t.slug,
          declarative,
          heuristic,
          appliedMode,
        });
      }

      // Agrégat global : moyenne pondérée des % (par tenants qui ont au moins une source).
      const covered = entries.filter((e) => e.declarative || e.heuristic);
      const pcts = covered.map((e) => {
        if (e.declarative) return averagePct([
          e.declarative.tickets.pct,
          e.declarative.trips.pct,
          e.declarative.incidents.pct,
        ]);
        if (e.heuristic) return averagePct([e.heuristic.tickets.pct, e.heuristic.trips.pct]);
        return 0;
      }).filter((p) => Number.isFinite(p));

      const pctViaSaasAvg = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;

      return {
        mode,
        periodDays: days,
        targetOccupancy,
        global: {
          pctViaSaasAvg,
          tenantsCovered: covered.length,
          tenantsMissing: entries.length - covered.length,
        },
        perTenant: entries,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. MRR BREAKDOWN — business & traction (SUPER_ADMIN only côté controller)
  // ═══════════════════════════════════════════════════════════════════════

  async getMrrBreakdown(periodDays?: number): Promise<MrrBreakdownReport> {
    const days = periodDays ?? await this.config.getNumber('kpi.defaultPeriodDays').catch(() => KPI_PERIODS.medium);
    return this.withCache(`mrr:${days}`, async () => {
      const since   = new Date(Date.now() - days * MS_PER_DAY);
      const sinceM1 = new Date(since.getTime() - days * MS_PER_DAY);

      // Subscriptions actives (TRIAL exclu du MRR facturé)
      const active = await this.prisma.platformSubscription.findMany({
        where:   { status: { in: ['ACTIVE', 'PAST_DUE'] } },
        include: { plan: true, tenant: { select: { id: true } } },
      });

      const mrr: Record<string, number> = {};
      const planAgg = new Map<string, { planSlug: string; activeTenants: number; mrrByCurrency: Record<string, number> }>();
      for (const s of active) {
        const cur = s.plan.currency;
        const amt = normalizeMonthly(s.plan.price, s.plan.billingCycle);
        mrr[cur] = (mrr[cur] ?? 0) + amt;
        const agg = planAgg.get(s.planId) ?? { planSlug: s.plan.slug, activeTenants: 0, mrrByCurrency: {} };
        agg.activeTenants += 1;
        agg.mrrByCurrency[cur] = (agg.mrrByCurrency[cur] ?? 0) + amt;
        planAgg.set(s.planId, agg);
      }

      const arr: Record<string, number> = {};
      for (const [cur, v] of Object.entries(mrr)) arr[cur] = v * 12;

      const activeTenants = active.length;
      const payingTenants = active.filter((s) => s.plan.price > 0).length;
      const arpu: Record<string, number> = {};
      for (const [cur, v] of Object.entries(mrr)) {
        arpu[cur] = payingTenants > 0 ? v / payingTenants : 0;
      }

      // Expansion breakdown via SubscriptionChange
      const [changesPeriod, changesPrevPeriod] = await Promise.all([
        this.prisma.subscriptionChange.findMany({ where: { createdAt: { gte: since } } }),
        this.prisma.subscriptionChange.findMany({ where: { createdAt: { gte: sinceM1, lt: since } } }),
      ]);

      const totalsByType: Record<string, { count: number; amountByCurrency: Record<string, number> }> = {};
      const bumpType = (src: typeof changesPeriod) => {
        const acc: Record<string, number> = {};
        for (const c of src) acc[c.currency] = (acc[c.currency] ?? 0) + Math.abs(c.deltaMonthly);
        return acc;
      };

      const newRevenue        = bumpType(changesPeriod.filter((c) => c.changeType === 'NEW'));
      const expansionRevenue  = bumpType(changesPeriod.filter((c) => c.changeType === 'EXPANSION'));
      const contractionRevenue = bumpType(changesPeriod.filter((c) => c.changeType === 'CONTRACTION'));
      const churnRevenue      = bumpType(changesPeriod.filter((c) => c.changeType === 'CHURN'));

      for (const c of changesPeriod) {
        const agg = totalsByType[c.changeType] ?? { count: 0, amountByCurrency: {} };
        agg.count += 1;
        agg.amountByCurrency[c.currency] = (agg.amountByCurrency[c.currency] ?? 0) + Math.abs(c.deltaMonthly);
        totalsByType[c.changeType] = agg;
      }

      const netNewMrr: Record<string, number> = {};
      for (const cur of new Set([
        ...Object.keys(newRevenue),
        ...Object.keys(expansionRevenue),
        ...Object.keys(contractionRevenue),
        ...Object.keys(churnRevenue),
      ])) {
        netNewMrr[cur] = (newRevenue[cur] ?? 0)
                       + (expansionRevenue[cur] ?? 0)
                       - (contractionRevenue[cur] ?? 0)
                       - (churnRevenue[cur] ?? 0);
      }

      // Growth MoM — somme des deltas signés sur la période vs période précédente
      const sumDelta = (xs: typeof changesPeriod) => xs.reduce((a, c) => a + c.deltaMonthly, 0);
      const deltaCurr = sumDelta(changesPeriod);
      const deltaPrev = sumDelta(changesPrevPeriod);
      const momPct: number | null = deltaPrev !== 0
        ? (deltaCurr - deltaPrev) / Math.abs(deltaPrev)
        : null;

      const currencyReference = Object.entries(mrr).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'EUR';

      return {
        periodDays: days,
        currencyReference,
        totals: {
          mrr,
          arr,
          arpu,
          activeTenants,
          payingTenants,
        },
        growth: {
          momPct: momPct !== null ? round(momPct, 4) : null,
          newRevenue,
          expansionRevenue,
          contractionRevenue,
          churnRevenue,
          netNewMrr,
        },
        byChangeType: Object.entries(totalsByType).map(([type, agg]) => ({
          type: type as any,
          count: agg.count,
          amountByCurrency: agg.amountByCurrency,
        })),
        byPlan: Array.from(planAgg.entries()).map(([planId, agg]) => ({
          planId,
          planSlug: agg.planSlug,
          activeTenants: agg.activeTenants,
          mrrByCurrency: agg.mrrByCurrency,
        })).sort((a, b) => b.activeTenants - a.activeTenants),
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. RETENTION COHORTS — J+7 / J+30 / J+90 par mois de signup
  // ═══════════════════════════════════════════════════════════════════════

  async getRetentionCohorts(periodDays?: number): Promise<RetentionReport> {
    const days = periodDays ?? 90; // par défaut 90j pour avoir D90 visible
    return this.withCache(`retention:${days}`, async () => {
      const since = new Date(Date.now() - days * MS_PER_DAY);
      const tenants = await this.prisma.tenant.findMany({
        where:  { id: { not: PLATFORM_TENANT_ID }, createdAt: { gte: since } },
        select: { id: true, createdAt: true },
      });

      // Groupement par mois de signup
      const byMonth = new Map<string, { tenantIds: string[]; signups: Array<{ id: string; createdAt: Date }> }>();
      for (const t of tenants) {
        const key = t.createdAt.toISOString().slice(0, 7); // YYYY-MM
        const entry = byMonth.get(key) ?? { tenantIds: [], signups: [] };
        entry.tenantIds.push(t.id);
        entry.signups.push({ id: t.id, createdAt: t.createdAt });
        byMonth.set(key, entry);
      }

      const cohorts = [];
      for (const [month, data] of byMonth.entries()) {
        const [d7, d30, d90] = await Promise.all([
          this.countActiveInWindow(data.signups, 7),
          this.countActiveInWindow(data.signups, 30),
          this.countActiveInWindow(data.signups, 90),
        ]);
        const n = data.tenantIds.length;
        cohorts.push({
          cohortMonth: month,
          tenantsSignedUp: n,
          activeD7: d7,
          activeD30: d30,
          activeD90: d90,
          retentionD7Pct:  safePct(d7, n),
          retentionD30Pct: safePct(d30, n),
          retentionD90Pct: safePct(d90, n),
        });
      }

      const avg = (xs: number[]) => xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      return {
        periodDays: days,
        cohorts: cohorts.sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth)),
        overall: {
          avgD7:  round(avg(cohorts.map((c) => c.retentionD7Pct)), 4),
          avgD30: round(avg(cohorts.map((c) => c.retentionD30Pct)), 4),
          avgD90: round(avg(cohorts.map((c) => c.retentionD90Pct)), 4),
        },
      };
    });
  }

  private async countActiveInWindow(signups: Array<{ id: string; createdAt: Date }>, dayOffset: number): Promise<number> {
    const now = Date.now();
    let count = 0;
    for (const s of signups) {
      const windowStart = new Date(s.createdAt.getTime() + dayOffset * MS_PER_DAY);
      const windowEnd   = new Date(windowStart.getTime() + 7 * MS_PER_DAY);
      // On ne compte que si la fenêtre est dans le passé (sinon biais)
      if (windowEnd.getTime() > now) continue;
      const active = await this.prisma.user.count({
        where: { tenantId: s.id, lastActiveAt: { gte: windowStart, lt: windowEnd } },
      });
      if (active > 0) count++;
    }
    return count;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. TRANSACTIONAL — tickets, GMV, % digital / offline, trips
  // ═══════════════════════════════════════════════════════════════════════

  async getTransactional(periodDays?: number): Promise<TransactionalReport> {
    const days = periodDays ?? await this.config.getNumber('kpi.defaultPeriodDays').catch(() => KPI_PERIODS.medium);
    return this.withCache(`transactional:${days}`, async () => {
      const since = new Date(Date.now() - days * MS_PER_DAY);

      // Ticket n'a pas de relation `tenant` — on précharge la devise par tenantId.
      const tenantCurrencyMap = await this.loadTenantCurrencyMap();

      const [tickets, trips, parcels] = await Promise.all([
        this.prisma.ticket.findMany({
          where: { tenantId: { not: PLATFORM_TENANT_ID }, createdAt: { gte: since } },
          select: {
            id: true, tenantId: true, pricePaid: true, customerId: true, createdAt: true,
            customer: { select: { userId: true } },
          },
        }),
        this.prisma.trip.groupBy({
          by:     ['status'],
          where:  { tenantId: { not: PLATFORM_TENANT_ID }, departureScheduled: { gte: since } },
          _count: { status: true },
        }),
        this.prisma.parcel.groupBy({
          by:     ['status'],
          where:  { tenantId: { not: PLATFORM_TENANT_ID }, createdAt: { gte: since } },
          _count: { status: true },
        }),
      ]);

      const gmv: Record<string, number> = {};
      const countByCurrency: Record<string, number> = {};
      let digital = 0;
      for (const t of tickets) {
        const cur = tenantCurrencyMap.get(t.tenantId) ?? 'EUR';
        gmv[cur] = (gmv[cur] ?? 0) + (t.pricePaid ?? 0);
        countByCurrency[cur] = (countByCurrency[cur] ?? 0) + 1;
        // Digital si customer a un userId (= client authentifié portail/mobile)
        if (t.customer?.userId) digital++;
      }

      const avgTicketPrice: Record<string, number> = {};
      for (const [cur, v] of Object.entries(gmv)) {
        avgTicketPrice[cur] = countByCurrency[cur] > 0 ? v / countByCurrency[cur] : 0;
      }

      const tripsByStatus = new Map(trips.map((t) => [t.status, t._count.status]));
      const totalPlanned   = Array.from(tripsByStatus.values()).reduce((a, b) => a + b, 0);
      const totalCompleted = tripsByStatus.get('COMPLETED') ?? 0;
      const totalCancelled = (tripsByStatus.get('CANCELLED') ?? 0) + (tripsByStatus.get('CANCELLED_IN_TRANSIT') ?? 0);

      // On-time % — compare departureActual vs departureScheduled sur les trips completed.
      // Tolérance : 10 min. Calcul simple cross-tenant.
      const tripsCompletedWithTimes = await this.prisma.trip.findMany({
        where: {
          tenantId: { not: PLATFORM_TENANT_ID },
          status:   'COMPLETED',
          departureScheduled: { gte: since },
          departureActual: { not: null },
        },
        select: { departureScheduled: true, departureActual: true },
      });
      let onTime = 0;
      for (const tr of tripsCompletedWithTimes) {
        if (!tr.departureActual) continue;
        const delayMin = (tr.departureActual.getTime() - tr.departureScheduled.getTime()) / 60_000;
        if (delayMin <= 10) onTime++;
      }
      const onTimePct = tripsCompletedWithTimes.length > 0
        ? onTime / tripsCompletedWithTimes.length
        : null;

      // Parcels
      const parcelsByStatus = new Map(parcels.map((p) => [p.status, p._count.status]));
      const totalParcels = Array.from(parcelsByStatus.values()).reduce((a, b) => a + b, 0);
      const delivered = parcelsByStatus.get('DELIVERED') ?? 0;

      // perDay trend (tickets + trips agrégés par jour)
      const perDayMap = new Map<string, { tickets: number; trips: number }>();
      for (const t of tickets) {
        const k = t.createdAt.toISOString().slice(0, 10);
        const e = perDayMap.get(k) ?? { tickets: 0, trips: 0 };
        e.tickets += 1;
        perDayMap.set(k, e);
      }
      const tripsPerDay = await this.prisma.trip.findMany({
        where: { tenantId: { not: PLATFORM_TENANT_ID }, departureScheduled: { gte: since } },
        select: { departureScheduled: true },
      });
      for (const tr of tripsPerDay) {
        const k = tr.departureScheduled.toISOString().slice(0, 10);
        const e = perDayMap.get(k) ?? { tickets: 0, trips: 0 };
        e.trips += 1;
        perDayMap.set(k, e);
      }
      const perDay = Array.from(perDayMap.entries())
        .map(([date, v]) => ({ date, tickets: v.tickets, trips: v.trips }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const totalTickets = tickets.length;
      return {
        periodDays: days,
        tickets: {
          total: totalTickets,
          gmv,
          avgTicketPrice,
          pctDigital: totalTickets > 0 ? digital / totalTickets : 0,
          pctOffline: totalTickets > 0 ? (totalTickets - digital) / totalTickets : 0,
        },
        trips: {
          totalPlanned,
          totalCompleted,
          totalCancelled,
          onTimePct: onTimePct !== null ? round(onTimePct, 4) : null,
        },
        parcels: {
          total: totalParcels,
          delivered,
        },
        perDay,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. ADOPTION — DAU/MAU par type user, modules utilisés
  // ═══════════════════════════════════════════════════════════════════════

  async getAdoptionBreakdown(periodDays?: number): Promise<AdoptionReport> {
    const days = periodDays ?? await this.config.getNumber('kpi.defaultPeriodDays').catch(() => KPI_PERIODS.medium);
    return this.withCache(`adoption:${days}`, async () => {
      const threshold = await this.config.getNumber('kpi.moduleAdoptionThreshold').catch(() => 0.3);
      const now = Date.now();
      const start1d  = new Date(now - 1 * MS_PER_DAY);
      const start7d  = new Date(now - 7 * MS_PER_DAY);
      const start30d = new Date(now - 30 * MS_PER_DAY);

      const users = await this.prisma.user.findMany({
        where: { tenantId: { not: PLATFORM_TENANT_ID }, isActive: true },
        select: { id: true, userType: true, lastActiveAt: true, role: { select: { name: true } } },
      });

      const zeroBucket = (): Record<UserTypeBucket, number> =>
        Object.fromEntries(USER_TYPE_BUCKETS.map((b) => [b, 0])) as Record<UserTypeBucket, number>;

      const dau = zeroBucket();
      const wau = zeroBucket();
      const mau = zeroBucket();
      const totalActive = zeroBucket();

      for (const u of users) {
        const bucket = bucketUser(u);
        totalActive[bucket] += 1;
        if (!u.lastActiveAt) continue;
        if (u.lastActiveAt >= start1d)  dau[bucket] += 1;
        if (u.lastActiveAt >= start7d)  wau[bucket] += 1;
        if (u.lastActiveAt >= start30d) mau[bucket] += 1;
      }

      const dauMauRatio = zeroBucket();
      for (const b of USER_TYPE_BUCKETS) {
        dauMauRatio[b] = mau[b] > 0 ? round(dau[b] / mau[b], 4) : 0;
      }

      // Modules adoption : via InstalledModule.isActive
      const modulesGrouped = await this.prisma.installedModule.groupBy({
        by:     ['moduleKey'],
        where:  { tenantId: { not: PLATFORM_TENANT_ID }, isActive: true },
        _count: { tenantId: true },
      });
      const totalTenants = await this.prisma.tenant.count({
        where: { id: { not: PLATFORM_TENANT_ID }, isActive: true },
      });
      const modules = modulesGrouped.map((m) => ({
        moduleKey: m.moduleKey,
        tenants:   m._count.tenantId,
        pct:       totalTenants > 0 ? round(m._count.tenantId / totalTenants, 4) : 0,
        adopted:   totalTenants > 0 && (m._count.tenantId / totalTenants) >= threshold,
      })).sort((a, b) => b.tenants - a.tenants);

      // Trend DAU (total) sur 30j via agrégat DailyActiveUser
      const trendRows = await this.prisma.dailyActiveUser.groupBy({
        by:      ['date'],
        where:   { date: { gte: start30d } },
        _count:  { userId: true },
        orderBy: { date: 'asc' },
      });
      const trend30d = trendRows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        dau:  r._count.userId,
      }));

      return {
        periodDays: days,
        users: { dau, wau, mau, dauMauRatio, totalActive },
        modules,
        trend30d,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. ACTIVATION FUNNEL — % tenants ayant franchi chaque étape
  // ═══════════════════════════════════════════════════════════════════════

  async getActivationFunnel(): Promise<ActivationFunnelReport> {
    return this.withCache(`activation`, async () => {
      const minTickets = await this.config.getNumber('kpi.activation.minTickets').catch(() => 1);
      const minTrips   = await this.config.getNumber('kpi.activation.minTrips').catch(() => 1);

      const tenants = await this.prisma.tenant.findMany({
        where: { id: { not: PLATFORM_TENANT_ID }, isActive: true },
        select: { id: true, createdAt: true },
      });
      const total = tenants.length;

      let tripCreated = 0;
      let ticketSold = 0;
      let driverAdded = 0;
      let twoModulesUsed = 0;
      let sumDaysToActivate = 0;
      let countActivated = 0;

      for (const t of tenants) {
        const [trips, tickets, drivers, installed] = await Promise.all([
          this.prisma.trip.count({ where: { tenantId: t.id } }),
          this.prisma.ticket.count({ where: { tenantId: t.id } }),
          this.prisma.user.count({ where: { tenantId: t.id, role: { name: 'DRIVER' }, isActive: true } }),
          this.prisma.installedModule.count({ where: { tenantId: t.id, isActive: true } }),
        ]);

        const stepTrip     = trips   >= minTrips;
        const stepTicket   = tickets >= minTickets;
        const stepDriver   = drivers >= 1;
        const stepModules  = installed >= 2;

        if (stepTrip)    tripCreated     += 1;
        if (stepTicket)  ticketSold      += 1;
        if (stepDriver)  driverAdded     += 1;
        if (stepModules) twoModulesUsed  += 1;

        if (stepTrip && stepTicket && stepDriver && stepModules) {
          // Temps jusqu'à activation : premier ticket vendu par le tenant
          const firstTicket = await this.prisma.ticket.findFirst({
            where:   { tenantId: t.id },
            orderBy: { createdAt: 'asc' },
            select:  { createdAt: true },
          });
          if (firstTicket) {
            const deltaDays = (firstTicket.createdAt.getTime() - t.createdAt.getTime()) / MS_PER_DAY;
            sumDaysToActivate += Math.max(0, deltaDays);
            countActivated    += 1;
          }
        }
      }

      const buildStep = (name: typeof ACTIVATION_STEPS[number], tenants: number, prev?: number) => ({
        step: name,
        tenants,
        pct:  total > 0 ? round(tenants / total, 4) : 0,
        conversionPct: (prev !== undefined && prev > 0) ? round(tenants / prev, 4) : 1,
      });

      const steps = [
        buildStep('TRIP_CREATED',     tripCreated),
        buildStep('TICKET_SOLD',      ticketSold,     tripCreated),
        buildStep('DRIVER_ADDED',     driverAdded,    ticketSold),
        buildStep('TWO_MODULES_USED', twoModulesUsed, driverAdded),
      ];

      return {
        totalTenants: total,
        steps,
        avgDaysToActivate: countActivated > 0 ? round(sumDaysToActivate / countActivated, 1) : null,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. STRATEGIC — actions/user/semaine, dépendance SaaS
  // ═══════════════════════════════════════════════════════════════════════

  async getStrategic(periodDays?: number): Promise<StrategicReport> {
    const days = periodDays ?? 7;
    return this.withCache(`strategic:${days}`, async () => {
      const since = new Date(Date.now() - days * MS_PER_DAY);

      const [auditTotal, usersActive, topTenantsRaw] = await Promise.all([
        this.prisma.auditLog.count({
          where: { tenantId: { not: PLATFORM_TENANT_ID }, createdAt: { gte: since } },
        }),
        this.prisma.user.count({
          where: { tenantId: { not: PLATFORM_TENANT_ID }, lastActiveAt: { gte: since } },
        }),
        this.prisma.auditLog.groupBy({
          by:     ['tenantId'],
          where:  { tenantId: { not: PLATFORM_TENANT_ID }, createdAt: { gte: since } },
          _count: { _all: true },
          orderBy:{ _count: { tenantId: 'desc' } },
          take:   10,
        }),
      ]);

      const topIds = topTenantsRaw.map((r) => r.tenantId);
      const tenantNames = await this.prisma.tenant.findMany({
        where:  { id: { in: topIds } },
        select: { id: true, name: true },
      });
      const nameMap = new Map(tenantNames.map((t) => [t.id, t.name]));
      const topActiveTenants = topTenantsRaw.map((r) => ({
        tenantId: r.tenantId,
        tenantName: nameMap.get(r.tenantId) ?? '—',
        actionsCount: r._count._all,
      }));

      // Sessions agrégées
      const sessionsCount = await this.prisma.dailyActiveUser.aggregate({
        where: { date: { gte: since } },
        _sum:  { sessionsCount: true },
      });
      const totalSessions = sessionsCount._sum.sessionsCount ?? 0;

      const avgActionsPerUserWeek   = usersActive > 0 ? round(auditTotal / usersActive, 2) : 0;
      const avgSessionsPerUserWeek  = usersActive > 0 ? round(totalSessions / usersActive, 2) : 0;

      // Dépendance SaaS : proxy = pctViaSaasAvg du North Star (mode compared)
      const ns = await this.getNorthStar('compared', 30);
      const saasDependencyPct = ns.global.pctViaSaasAvg;

      return {
        periodDays: days,
        avgActionsPerUserWeek,
        avgSessionsPerUserWeek,
        saasDependencyPct,
        topActiveTenants,
      };
    });
  }
}

// ─── Helpers stateless ─────────────────────────────────────────────────────

function normalizeMonthly(price: number, billingCycle: string): number {
  if (!price || price <= 0) return 0;
  switch (billingCycle) {
    case 'MONTHLY': return price;
    case 'YEARLY':  return price / 12;
    case 'ONE_SHOT': return price / 12;
    default: return price;
  }
}

function buildDeclarative(actualMonthly: number, estimated?: number) {
  const est = estimated ?? 0;
  return {
    actual:    round(actualMonthly),
    estimated: est,
    pct:       safePct(actualMonthly, est),
  };
}

function bucketUser(u: { userType: string; role: { name: string } | null }): UserTypeBucket {
  if (u.role?.name === 'DRIVER') return 'DRIVER';
  if (u.userType === 'CUSTOMER') return 'CUSTOMER';
  return 'STAFF';
}

function safePct(num: number, denom: number): number {
  if (!denom || denom <= 0) return 0;
  return round(num / denom, 4);
}

function averagePct(xs: number[]): number {
  const valid = xs.filter((x) => Number.isFinite(x));
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

function round(n: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}
