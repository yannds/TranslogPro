/**
 * SeasonalityService — KPI saisonniers (Sprint 4).
 *
 * Agrège les trips COMPLETED + TripCostSnapshot en `SeasonalAggregate` par
 * période (YEAR, MONTH, WEEK, WEEKEND, WEEKDAY) pour la page
 * `/admin/analytics/seasonality`.
 *
 * Règle YoY progressive (déterministe, aucun chiffre fabriqué) :
 *   < 30 jours       → INSUFFICIENT  (aucune comparaison)
 *   1-3 mois         → SHORT         (mensuel seul, badge "Période courte")
 *   3-12 mois        → MEDIUM        (comparaisons M-1 / M-3, pas de YoY)
 *   ≥ 12 mois        → YOY           (YoY débloqué)
 *   ≥ 24 mois        → MULTI_YEAR    (tendance pluriannuelle)
 *
 * Zéro magic number — les seuils de la fenêtre sont dans PlatformConfig.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export type HistoryWindow =
  | 'INSUFFICIENT'
  | 'SHORT'
  | 'MEDIUM'
  | 'YOY'
  | 'MULTI_YEAR';

export type SeasonalPeriodType = 'YEAR' | 'MONTH' | 'WEEK' | 'WEEKEND' | 'WEEKDAY';

export interface HistoryWindowInfo {
  window:        HistoryWindow;
  firstTripDate: Date | null;
  daysOfHistory: number;
  yoyAvailable:  boolean;
}

// Seuils de la fenêtre progressive. En jours, conformes à la règle validée.
// Placés ici plutôt que dans platform-config car ce sont des seuils produit
// stables (pas des réglages tenant-configurables : chaque tenant a la même
// règle pour éviter des YoY fabriqués).
const WINDOW_THRESHOLDS_DAYS = {
  short:     30,
  medium:    90,      // 3 mois
  yoy:       365,     // 12 mois
  multiYear: 730,     // 24 mois
} as const;

/** Tronque une date à minuit UTC. */
function startOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/** Clé "2026-04" à partir d'une date. */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Début de mois UTC. */
function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Début d'année UTC. */
function startOfYearUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

/**
 * Semaine ISO (lundi-dimanche). Retourne clé `2026-W17` et la date du lundi.
 * Algorithme ISO 8601 standard.
 */
function isoWeek(d: Date): { year: number; week: number; start: Date } {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Décale au jeudi de la semaine ISO (mercredi = semaine 1 rule).
  const dayNr = (target.getUTCDay() + 6) % 7; // 0=lundi..6=dimanche
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const weekNumber = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  const monday = new Date(d);
  const dow = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - dow);
  return { year: target.getUTCFullYear(), week: weekNumber, start: startOfDayUtc(monday) };
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6; // dimanche ou samedi
}

interface TripBucketAccum {
  tenantId:    string;
  routeId:     string | null;
  periodType:  SeasonalPeriodType;
  periodKey:   string;
  startAt:     Date;
  tickets:     number;
  revenue:     number;
  tripCount:   number;
  profitable:  number;
  deficit:     number;
  fillRateSum: number; // somme pondérée, divisée à la fin
  netMarginSum: number;
}

@Injectable()
export class SeasonalityService {
  private readonly logger = new Logger(SeasonalityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Fenêtre d'historique disponible pour le tenant. */
  async computeHistoryWindow(tenantId: string): Promise<HistoryWindowInfo> {
    const earliest = await this.prisma.trip.findFirst({
      where:   { tenantId, status: 'COMPLETED' },
      orderBy: { departureScheduled: 'asc' },
      select:  { departureScheduled: true },
    });
    if (!earliest) {
      return { window: 'INSUFFICIENT', firstTripDate: null, daysOfHistory: 0, yoyAvailable: false };
    }
    const days = Math.floor(
      (Date.now() - earliest.departureScheduled.getTime()) / (24 * 3_600_000),
    );
    let window: HistoryWindow = 'INSUFFICIENT';
    if (days >= WINDOW_THRESHOLDS_DAYS.multiYear)     window = 'MULTI_YEAR';
    else if (days >= WINDOW_THRESHOLDS_DAYS.yoy)      window = 'YOY';
    else if (days >= WINDOW_THRESHOLDS_DAYS.medium)   window = 'MEDIUM';
    else if (days >= WINDOW_THRESHOLDS_DAYS.short)    window = 'SHORT';
    return {
      window,
      firstTripDate: earliest.departureScheduled,
      daysOfHistory: days,
      yoyAvailable:  days >= WINDOW_THRESHOLDS_DAYS.yoy,
    };
  }

  /**
   * Recompute full pour un tenant : supprime les agrégats existants et
   * recalcule tout depuis les trips COMPLETED + TripCostSnapshot. Idempotent.
   * Retourne le compte de lignes créées par periodType.
   */
  async recomputeForTenant(tenantId: string): Promise<Record<SeasonalPeriodType, number>> {
    const trips = await this.prisma.trip.findMany({
      where: { tenantId, status: 'COMPLETED' },
      select: {
        id: true, routeId: true, departureScheduled: true,
        costSnapshot: {
          select: {
            ticketRevenue: true, parcelRevenue: true,
            fillRate: true, netMargin: true, profitabilityTag: true,
          },
        },
      },
    });

    const buckets = new Map<string, TripBucketAccum>();
    const add = (
      routeId: string | null,
      periodType: SeasonalPeriodType,
      periodKey: string,
      startAt: Date,
      trip: typeof trips[number],
    ) => {
      const k = `${routeId ?? 'TENANT'}|${periodType}|${periodKey}`;
      let b = buckets.get(k);
      if (!b) {
        b = {
          tenantId, routeId, periodType, periodKey, startAt,
          tickets: 0, revenue: 0, tripCount: 0, profitable: 0, deficit: 0,
          fillRateSum: 0, netMarginSum: 0,
        };
        buckets.set(k, b);
      }
      b.tripCount++;
      const s = trip.costSnapshot;
      if (s) {
        b.revenue      += (s.ticketRevenue ?? 0) + (s.parcelRevenue ?? 0);
        b.fillRateSum  += s.fillRate ?? 0;
        b.netMarginSum += s.netMargin ?? 0;
        if (s.profitabilityTag === 'PROFITABLE') b.profitable++;
        if (s.profitabilityTag === 'DEFICIT')    b.deficit++;
      }
    };

    for (const trip of trips) {
      const d = startOfDayUtc(trip.departureScheduled);
      const routeId = trip.routeId;

      // Un trip compte dans chaque agrégat (tenant global + par route) sur
      // chaque periodType applicable.
      for (const rid of [null, routeId] as const) {
        add(rid, 'YEAR',    String(d.getUTCFullYear()), startOfYearUtc(d), trip);
        add(rid, 'MONTH',   monthKey(d),                startOfMonthUtc(d), trip);
        const w = isoWeek(d);
        add(rid, 'WEEK',    `${w.year}-W${String(w.week).padStart(2, '0')}`, w.start, trip);
        if (isWeekend(d)) {
          add(rid, 'WEEKEND', `${monthKey(d)}-WE`, startOfMonthUtc(d), trip);
        } else {
          add(rid, 'WEEKDAY', `${monthKey(d)}-WD`, startOfMonthUtc(d), trip);
        }
      }
    }

    // Upsert en base (delete+createMany est plus simple et reproductible).
    await this.prisma.seasonalAggregate.deleteMany({ where: { tenantId } });
    const rows = Array.from(buckets.values()).map(b => ({
      tenantId:        b.tenantId,
      routeId:         b.routeId,
      periodType:      b.periodType,
      periodKey:       b.periodKey,
      periodStartAt:   b.startAt,
      ticketsSold:     b.tickets,
      revenueTotal:    b.revenue,
      tripCount:       b.tripCount,
      profitableCount: b.profitable,
      deficitCount:    b.deficit,
      fillRateAvg:     b.tripCount > 0 ? b.fillRateSum  / b.tripCount : 0,
      netMarginAvg:    b.tripCount > 0 ? b.netMarginSum / b.tripCount : 0,
    }));
    if (rows.length > 0) {
      await this.prisma.seasonalAggregate.createMany({ data: rows });
    }

    // Seconde passe : calculer vsPreviousPct + vsLastYearPct.
    await this.computeDeltas(tenantId);

    // Stats pour le log.
    const stats: Record<SeasonalPeriodType, number> = {
      YEAR: 0, MONTH: 0, WEEK: 0, WEEKEND: 0, WEEKDAY: 0,
    };
    for (const r of rows) stats[r.periodType as SeasonalPeriodType]++;
    this.logger.log(`[seasonality] tenant=${tenantId} ${rows.length} aggregates: ${JSON.stringify(stats)}`);
    return stats;
  }

  /**
   * Calcule vsPreviousPct + vsLastYearPct en croisant les agrégats entre eux
   * (pas de requête externe). Appelé juste après recompute.
   */
  private async computeDeltas(tenantId: string): Promise<void> {
    const all = await this.prisma.seasonalAggregate.findMany({
      where: { tenantId },
      orderBy: [{ periodType: 'asc' }, { routeId: 'asc' }, { periodStartAt: 'asc' }],
    });
    // Index par (routeId|key) pour retrouver la période précédente / Y-1.
    const byKey = new Map<string, typeof all[number]>();
    for (const r of all) byKey.set(`${r.routeId ?? 'T'}|${r.periodType}|${r.periodKey}`, r);

    const updates: { id: string; vsPreviousPct: number | null; vsLastYearPct: number | null }[] = [];

    const pct = (curr: number, prev: number): number | null => {
      if (prev === 0 || !Number.isFinite(prev)) return null;
      return ((curr - prev) / Math.abs(prev)) * 100;
    };

    for (const row of all) {
      const prevKey = this.previousPeriodKey(row.periodType as SeasonalPeriodType, row.periodKey, -1);
      const yoyKey  = this.previousPeriodKey(row.periodType as SeasonalPeriodType, row.periodKey, -12);
      const prev = prevKey ? byKey.get(`${row.routeId ?? 'T'}|${row.periodType}|${prevKey}`) : undefined;
      const yoy  = yoyKey  ? byKey.get(`${row.routeId ?? 'T'}|${row.periodType}|${yoyKey}`)  : undefined;

      const vsPrev = prev ? pct(row.revenueTotal, prev.revenueTotal) : null;
      const vsYoy  = yoy  ? pct(row.revenueTotal, yoy.revenueTotal)  : null;

      if (vsPrev !== row.vsPreviousPct || vsYoy !== row.vsLastYearPct) {
        updates.push({ id: row.id, vsPreviousPct: vsPrev, vsLastYearPct: vsYoy });
      }
    }

    for (const u of updates) {
      await this.prisma.seasonalAggregate.update({
        where: { id: u.id },
        data:  { vsPreviousPct: u.vsPreviousPct, vsLastYearPct: u.vsLastYearPct },
      });
    }
  }

  /**
   * Retourne la clé de la période N pas avant (ex: offset=-12 pour YoY).
   * Null si le periodType ne supporte pas cette granularité.
   */
  private previousPeriodKey(
    periodType: SeasonalPeriodType,
    key: string,
    offset: number,
  ): string | null {
    if (periodType === 'MONTH') {
      const [y, m] = key.split('-').map(Number);
      if (!y || !m) return null;
      const d = new Date(Date.UTC(y, m - 1 + offset, 1));
      return monthKey(d);
    }
    if (periodType === 'YEAR') {
      const y = Number(key);
      if (!y) return null;
      // Offset en mois : pour YEAR on divise par 12 (YoY=année précédente pour offset=-12).
      return String(y + Math.floor(offset / 12));
    }
    if (periodType === 'WEEKEND' || periodType === 'WEEKDAY') {
      const base = key.slice(0, 7); // "2026-04"
      const suffix = key.slice(7);  // "-WE" ou "-WD"
      const [y, m] = base.split('-').map(Number);
      if (!y || !m) return null;
      const d = new Date(Date.UTC(y, m - 1 + offset, 1));
      return `${monthKey(d)}${suffix}`;
    }
    // WEEK : arithmétique ISO plus complexe — hors scope S4, on ignore.
    return null;
  }

  /** Query filtrée pour l'API/UI. */
  async query(tenantId: string, filters: {
    periodType: SeasonalPeriodType;
    routeId?:   string | null;
    from?:      Date;
    to?:        Date;
  }) {
    const window = await this.computeHistoryWindow(tenantId);
    const rows = await this.prisma.seasonalAggregate.findMany({
      where: {
        tenantId,
        periodType: filters.periodType,
        ...(filters.routeId === undefined ? {} : { routeId: filters.routeId }),
        ...(filters.from ? { periodStartAt: { gte: filters.from } } : {}),
        ...(filters.to   ? { periodStartAt: { lte: filters.to }   } : {}),
      },
      orderBy: { periodStartAt: 'asc' },
    });
    return { window, rows };
  }

  /** Appelé par le scheduler nocturne pour tous les tenants actifs. */
  async recomputeAllTenants(): Promise<{ tenantsProcessed: number; totalRows: number }> {
    const tenants = await this.prisma.tenant.findMany({
      where:  { provisionStatus: 'ACTIVE' },
      select: { id: true, slug: true },
    });
    let totalRows = 0;
    for (const t of tenants) {
      try {
        const stats = await this.recomputeForTenant(t.id);
        totalRows += Object.values(stats).reduce((a, b) => a + b, 0);
      } catch (err) {
        this.logger.error(`[seasonality] Échec recompute tenant=${t.slug}`, err as Error);
      }
    }
    return { tenantsProcessed: tenants.length, totalRows };
  }
}
