import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * Fenêtre glissante (ms) utilisée pour compter les clôtures caisse avec écart
 * exposées au KPI admin. 30 jours par défaut — aligné sur l'horizon rétention
 * que la plupart des transporteurs exigent pour un audit mensuel.
 */
const DISCREPANCY_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

/**
 * Échappe une valeur pour insertion dans une ligne CSV RFC 4180.
 * Guillemets doublés + encadrement si virgule / newline / guillemet.
 */
function csvEscape(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  const needsQuote = /[",\n\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * KPIs lean du jour — consommé par l'app mobile admin.
   * Payload minimal pour un affichage rapide (pas de historique, pas de séries).
   *
   * Security : filtrage strict par tenantId. Scope .agency déjà géré côté
   * controller (injecte agencyId de l'acteur si scope='agency').
   */
  async getKpis(tenantId: string, agencyId?: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    const ticketFilter = {
      tenantId,
      createdAt: { gte: startOfDay, lte: endOfDay },
      ...(agencyId ? { agencyId } : {}),
    };
    const parcelFilter = {
      tenantId,
      createdAt: { gte: startOfDay, lte: endOfDay },
      ...(agencyId ? { agencyId } : {}),
    };
    const registerFilter = {
      tenantId,
      status: 'OPEN' as const,
      ...(agencyId ? { agencyId } : {}),
    };
    const discrepancyFilter = {
      tenantId,
      status: 'DISCREPANCY' as const,
      closedAt: {
        gte: new Date(Date.now() - DISCREPANCY_WINDOW_MS),
      },
      ...(agencyId ? { agencyId } : {}),
    };

    const [ticketsToday, parcelsToday, openIncidents, openRegisters, discrepancyCount] = await Promise.all([
      this.prisma.ticket.count({ where: ticketFilter }),
      this.prisma.parcel.count({ where: parcelFilter }),
      this.prisma.incident.count({ where: { tenantId, status: { in: ['OPEN', 'ASSIGNED'] } } }),
      this.prisma.cashRegister.count({ where: registerFilter }),
      this.prisma.cashRegister.count({ where: discrepancyFilter }),
    ]);

    return { ticketsToday, parcelsToday, openIncidents, openRegisters, discrepancyCount };
  }

  /**
   * Export CSV des ventes billets sur une période.
   *
   * Sécurité :
   *   - Filtrage WHERE strict : tenantId + agencyId si scope.agency.
   *   - Fenêtre plafonnée (configurable) pour éviter un dump dégénéré.
   *   - Pas de PII du CRM : on exporte le passengerName (présent sur le billet
   *     et déjà connu de l'acteur) mais pas l'email/téléphone.
   *
   * Retour : CSV string (le controller ajoute le Content-Disposition).
   */
  async exportTicketsCsv(
    tenantId: string,
    agencyId: string | undefined,
    from: Date,
    to: Date,
    maxRows: number,
  ): Promise<string> {
    const rows = await this.prisma.ticket.findMany({
      where: {
        tenantId,
        createdAt: { gte: from, lte: to },
        ...(agencyId ? { agencyId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take:    maxRows,
      select: {
        id: true, status: true, fareClass: true, seatNumber: true,
        pricePaid: true, agencyId: true, createdAt: true,
        passengerName: true, tripId: true,
      },
    });

    const header = [
      'id', 'createdAt', 'status', 'fareClass', 'seatNumber',
      'pricePaid', 'agencyId', 'tripId', 'passengerName',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.id,
        r.createdAt.toISOString(),
        r.status,
        r.fareClass,
        r.seatNumber ?? '',
        String(r.pricePaid),
        r.agencyId ?? '',
        r.tripId,
        csvEscape(r.passengerName),
      ].join(','));
    }
    return lines.join('\n');
  }

  /**
   * Dashboard agrégé.
   * agencyId fourni → filtre les tickets/transactions sur l'agence.
   * Trip n'a pas de champ agencyId — le décompte trips est tenant-global
   * (un trajet appartient à un tenant, pas à une agence).
   */
  async getDashboard(tenantId: string, agencyId?: string) {
    const ticketFilter      = { tenantId, ...(agencyId ? { agencyId } : {}) };
    const transactionFilter = { tenantId, ...(agencyId ? { agencyId } : {}) };

    const [
      totalTrips,
      activeTrips,
      totalTickets,
      totalRevenue,
      totalParcels,
      openIncidents,
    ] = await Promise.all([
      this.prisma.trip.count({ where: { tenantId } }),
      this.prisma.trip.count({ where: { tenantId, status: { in: ['BOARDING', 'IN_PROGRESS'] } } }),
      this.prisma.ticket.count({ where: ticketFilter }),
      this.prisma.transaction.aggregate({
        where: transactionFilter,
        _sum:  { amount: true },
      }),
      this.prisma.parcel.count({ where: { tenantId } }),
      this.prisma.incident.count({ where: { tenantId, status: { in: ['OPEN', 'ASSIGNED'] } } }),
    ]);

    return {
      trips:     { total: totalTrips, active: activeTrips },
      tickets:   { total: totalTickets },
      revenue:   { total: totalRevenue._sum.amount ?? 0, currency: 'XOF' },
      parcels:   { total: totalParcels },
      incidents: { open: openIncidents },
    };
  }

  /**
   * Rapport trips par statut sur une période.
   * Scope agency → filtre les trips qui ont au moins un ticket de l'agence
   * (Trip.id IN SELECT DISTINCT tripId FROM tickets WHERE agencyId = ?).
   */
  async getTripsReport(tenantId: string, from: Date, to: Date, agencyId?: string) {
    const tripIdFilter = agencyId
      ? {
          id: {
            in: (
              await this.prisma.ticket.findMany({
                where:  { tenantId, agencyId },
                select: { tripId: true },
                distinct: ['tripId'],
              })
            ).map(t => t.tripId),
          },
        }
      : {};

    return this.prisma.trip.groupBy({
      by:     ['status'],
      where:  { tenantId, departureScheduled: { gte: from, lte: to }, ...tripIdFilter },
      _count: { _all: true },
    });
  }

  /**
   * Rapport revenus par type de transaction.
   * Scope agency → filtre strict sur Transaction.agencyId.
   */
  async getRevenueReport(tenantId: string, from: Date, to: Date, agencyId?: string) {
    return this.prisma.transaction.groupBy({
      by:    ['type'],
      where: {
        tenantId,
        createdAt: { gte: from, lte: to },
        ...(agencyId ? { agencyId } : {}),
      },
      _sum:   { amount: true },
      _count: { _all: true },
    });
  }

  /**
   * Résumé "Aujourd'hui" pour le dashboard exécutif du gérant (Sprint 4).
   *
   * Agrège tout ce dont la page a besoin en UN SEUL appel :
   *   - KPI jour : CA, billets, colis, taux remplissage estimé, incidents,
   *     écarts caisse, caisses ouvertes
   *   - Série 7 derniers jours : CA/jour (graphique)
   *   - Seuils d'alerte (lus depuis TenantBusinessConfig — zéro magic number)
   *   - Flags d'alerte pré-calculés côté serveur (discrepancyAlert, incidentAlert,
   *     fillRateAlert) — le front n'a plus qu'à afficher un bandeau.
   *
   * Security : filtrage strict tenantId + scope agency appliqué au controller.
   * Perf : 7 requêtes Prisma en parallèle (~100ms sur DB chaude).
   */
  async getTodaySummary(tenantId: string, agencyId?: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    const sevenDaysAgo = new Date(startOfDay);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // 7 jours inclusifs

    const agencyScope = agencyId ? { agencyId } : {};

    const [
      kpis,
      revenueToday,
      revenue7d,
      activeTripsToday,
      config,
      fillRateStats,
    ] = await Promise.all([
      this.getKpis(tenantId, agencyId),
      this.prisma.transaction.aggregate({
        where: { tenantId, createdAt: { gte: startOfDay, lte: endOfDay }, ...agencyScope },
        _sum:  { amount: true },
      }),
      this.prisma.transaction.findMany({
        where:  { tenantId, createdAt: { gte: sevenDaysAgo, lte: endOfDay }, ...agencyScope },
        select: { amount: true, createdAt: true },
      }),
      this.prisma.trip.count({
        where: { tenantId, departureScheduled: { gte: startOfDay, lte: endOfDay }, status: { in: ['PLANNED', 'OPEN', 'BOARDING', 'IN_PROGRESS'] } },
      }),
      this.prisma.tenantBusinessConfig.findUnique({
        where: { tenantId },
        select: {
          anomalyIncidentThreshold:    true,
          anomalyDiscrepancyThreshold: true,
          anomalyFillRateFloor:        true,
        },
      }),
      this.computeDayFillRate(tenantId, startOfDay, endOfDay, agencyId),
    ]);

    // Agrégation revenue par jour (7 derniers jours, label court)
    const revenueByDay = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      revenueByDay.set(this.dayKey(d), 0);
    }
    for (const t of revenue7d) {
      const key = this.dayKey(t.createdAt);
      if (revenueByDay.has(key)) {
        revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + (t.amount ?? 0));
      }
    }
    const revenue7dSeries = [...revenueByDay.entries()].map(([key, value]) => ({
      label: key,
      value,
    }));

    // Seuils (fallback defaults alignés sur schema Prisma)
    const incidentThreshold    = config?.anomalyIncidentThreshold    ?? 3;
    const discrepancyThreshold = config?.anomalyDiscrepancyThreshold ?? 1;
    const fillRateFloor        = config?.anomalyFillRateFloor        ?? 0.4;

    return {
      today: {
        revenue:            revenueToday._sum.amount ?? 0,
        ticketsSold:        kpis.ticketsToday,
        parcelsRegistered:  kpis.parcelsToday,
        openIncidents:      kpis.openIncidents,
        openRegisters:      kpis.openRegisters,
        discrepancyCount:   kpis.discrepancyCount,
        activeTrips:        activeTripsToday,
        fillRate:           fillRateStats.fillRate,
        fillRateTripsCount: fillRateStats.tripsCount,
      },
      revenue7d: revenue7dSeries,
      thresholds: {
        incident:    incidentThreshold,
        discrepancy: discrepancyThreshold,
        fillRate:    fillRateFloor,
      },
      alerts: {
        incidentAlert:    kpis.openIncidents    >= incidentThreshold,
        discrepancyAlert: kpis.discrepancyCount >= discrepancyThreshold,
        fillRateAlert:    fillRateStats.tripsCount > 0 && fillRateStats.fillRate < fillRateFloor,
      },
    };
  }

  /** Taux de remplissage moyen des trajets du jour (boardé / capacité). */
  private async computeDayFillRate(
    tenantId: string,
    startOfDay: Date,
    endOfDay: Date,
    agencyId?: string,
  ): Promise<{ fillRate: number; tripsCount: number }> {
    // On ignore agencyId ici : Trip est tenant-scoped (pas d'agencyId direct).
    // Pour scope agency stricte il faudrait filtrer via tickets — coûteux sur ce
    // KPI agrégé. Vue agency → tenant pour le fillRate (documenté).
    void agencyId;
    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        departureScheduled: { gte: startOfDay, lte: endOfDay },
        status: { in: ['BOARDING', 'IN_PROGRESS', 'COMPLETED'] },
      },
      include: {
        bus:       { select: { capacity: true } },
        travelers: { where: { status: 'BOARDED' }, select: { id: true } },
      },
    });
    if (trips.length === 0) return { fillRate: 0, tripsCount: 0 };
    let totalCapacity = 0;
    let totalBoarded  = 0;
    for (const trip of trips) {
      totalCapacity += trip.bus.capacity;
      totalBoarded  += trip.travelers.length;
    }
    return {
      fillRate:   totalCapacity > 0 ? totalBoarded / totalCapacity : 0,
      tripsCount: trips.length,
    };
  }

  /** Clé ISO "YYYY-MM-DD" d'une date (fuseau local du serveur). */
  private dayKey(d: Date): string {
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  /**
   * Synthèse flotte (Sprint 5) — pour le manager de flotte.
   * Agrège count par état (active / maintenance / offline) + top bus
   * sous-utilisés (utilization < seuil tenant anomalyFillRateFloor sur 7j).
   */
  async getFleetSummary(tenantId: string, agencyId?: string) {
    const agencyScope = agencyId ? { agencyId } : {};
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Buckets de statuts (documentés dans schema : AVAILABLE | BOARDING | DEPARTED
    // | ARRIVED | MAINTENANCE | CLOSED | IN_SERVICE)
    const ACTIVE_STATUSES = ['AVAILABLE', 'IN_SERVICE', 'BOARDING', 'DEPARTED', 'ARRIVED'];

    const [total, active, maintenance, closed, buses, config] = await Promise.all([
      this.prisma.bus.count({ where: { tenantId, ...agencyScope } }),
      this.prisma.bus.count({ where: { tenantId, ...agencyScope, status: { in: ACTIVE_STATUSES } } }),
      this.prisma.bus.count({ where: { tenantId, ...agencyScope, status: 'MAINTENANCE' } }),
      this.prisma.bus.count({ where: { tenantId, ...agencyScope, status: 'CLOSED' } }),
      this.prisma.bus.findMany({
        where:  { tenantId, ...agencyScope, status: { in: ACTIVE_STATUSES } },
        select: {
          id: true, plateNumber: true, model: true, capacity: true,
          trips: {
            where:  { departureScheduled: { gte: sevenDaysAgo, lte: now }, status: { in: ['BOARDING', 'IN_PROGRESS', 'COMPLETED'] } },
            select: { id: true, travelers: { where: { status: 'BOARDED' }, select: { id: true } } },
          },
        },
      }),
      this.prisma.tenantBusinessConfig.findUnique({
        where:  { tenantId },
        select: { anomalyFillRateFloor: true },
      }),
    ]);

    const floor = config?.anomalyFillRateFloor ?? 0.4;

    // Utilization par bus (7j) = totalBoarded / (capacity * nbTrips)
    const buses7dUtil = buses.map(bus => {
      const totalBoarded = bus.trips.reduce((sum, t) => sum + t.travelers.length, 0);
      const totalSeats   = bus.capacity * bus.trips.length;
      const util         = totalSeats > 0 ? totalBoarded / totalSeats : 0;
      return {
        busId:         bus.id,
        plateNumber:   bus.plateNumber,
        model:         bus.model,
        tripCount7d:   bus.trips.length,
        utilization7d: util,
      };
    });

    const underutilized = buses7dUtil
      .filter(b => b.tripCount7d > 0 && b.utilization7d < floor)
      .sort((a, b) => a.utilization7d - b.utilization7d)
      .slice(0, 5);

    return {
      total,
      byStatus:        { active, maintenance, offline: closed },
      underutilized,
      underutilizedThreshold: floor,
    };
  }

  async getOccupancyRate(tenantId: string, tripId: string) {
    const trip = await this.prisma.trip.findFirst({
      where:   { id: tripId, tenantId },
      include: { bus: true, travelers: true },
    });
    if (!trip) return null;

    const boarded = trip.travelers.filter(t => t.status === 'BOARDED').length;
    return {
      tripId,
      capacity:      trip.bus.capacity,
      boarded,
      occupancyRate: trip.bus.capacity > 0
        ? Math.round((boarded / trip.bus.capacity) * 100)
        : 0,
    };
  }

  /**
   * Segmentation des clients (CUSTOMER) par ACTIVITÉ — pas par rôle.
   *
   * Le rôle CUSTOMER unifie voyageur + expéditeur ; la distinction utile pour
   * la BI (combien de voyageurs purs, combien d'expéditeurs purs, combien font
   * les deux) se calcule sur l'activité observée :
   *   - has_ticket = au moins un Ticket avec passengerId = userId
   *   - has_parcel = au moins un Parcel avec senderId    = userId
   *
   * Implémentation : 3 requêtes O(N) :
   *   1. count des CUSTOMER du tenant
   *   2. distinct passengerId depuis Ticket
   *   3. distinct senderId    depuis Parcel
   * Puis intersection en mémoire — suffisant tant que N(customers) < ~100k.
   * Au-delà : projeter via une vue matérialisée (CustomerActivity).
   */
  async getCustomerSegmentation(tenantId: string) {
    const [totalCustomers, ticketBuyers, parcelSenders] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, userType: 'CUSTOMER' } }),
      this.prisma.ticket.findMany({
        where:    { tenantId },
        select:   { passengerId: true },
        distinct: ['passengerId'],
      }),
      this.prisma.parcel.findMany({
        where:    { tenantId },
        select:   { senderId: true },
        distinct: ['senderId'],
      }),
    ]);

    const travelers = new Set(ticketBuyers.map(t => t.passengerId).filter((s): s is string => !!s));
    const shippers  = new Set(parcelSenders.map(p => p.senderId).filter((s): s is string => !!s));

    let both = 0;
    for (const id of travelers) if (shippers.has(id)) both++;

    const travelersOnly = travelers.size - both;
    const shippersOnly  = shippers.size  - both;
    const active        = travelers.size + shippers.size - both;
    const inactive      = Math.max(0, totalCustomers - active);

    return {
      total:         totalCustomers,
      active,
      inactive,
      travelersOnly,
      shippersOnly,
      both,
    };
  }

  // ─── AI / Yield Management ────────────────────────────────────────────────────

  private static readonly DAY_MS = 24 * 60 * 60 * 1_000;

  /**
   * Classement des lignes par score de rentabilité (90 derniers jours).
   * Source : TripAnalytics (pré-agrégé par le cron nuit).
   * Score = fillRate*60 + ratio_trips_rentables*30 + fréquence*10 (sur 100).
   */
  async getAiRoutes(tenantId: string) {
    try {
      return await this._getAiRoutes(tenantId);
    } catch (err) {
      this.logger.error(
        `getAiRoutes failed for tenant=${tenantId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return [];
    }
  }

  private async _getAiRoutes(tenantId: string) {
    const since = new Date(Date.now() - 90 * AnalyticsService.DAY_MS);

    const [analytics, blackRows] = await Promise.all([
      this.prisma.tripAnalytics.groupBy({
        by:     ['routeId'],
        where:  { tenantId, tripDate: { gte: since } },
        _avg:   { avgFillRate: true, avgNetMargin: true, avgTicketRevenue: true },
        _sum:   { tripCount: true, profitableCount: true },
        orderBy: { _avg: { avgFillRate: 'desc' } },
        take:   10,
      }),
      this.prisma.tripAnalytics.groupBy({
        by:     ['routeId'],
        where:  { tenantId, tripDate: { gte: since }, isBlackRoute: true },
        _count: { _all: true },
      }),
    ]);

    if (analytics.length === 0) return [];

    const blackSet  = new Set(blackRows.map(r => r.routeId));
    const routeIds  = analytics.map(a => a.routeId);
    const routes    = await this.prisma.route.findMany({
      where:   { id: { in: routeIds }, tenantId },
      include: {
        origin:      { select: { name: true } },
        destination: { select: { name: true } },
      },
    });
    const routeMap = new Map(routes.map(r => [r.id, r]));

    return analytics.map(a => {
      const fillRate       = a._avg.avgFillRate       ?? 0;
      const ticketRevenue  = a._avg.avgTicketRevenue  ?? 0;
      const netMargin      = a._avg.avgNetMargin      ?? 0;
      const tripCount      = a._sum.tripCount         ?? 0;
      const profitCount    = a._sum.profitableCount   ?? 0;
      const profitRatio    = tripCount > 0 ? profitCount / tripCount : 0;
      const freqScore      = Math.min(1, tripCount / 90);
      const score          = Math.max(0, Math.min(100,
        Math.round(fillRate * 60 + profitRatio * 30 + freqScore * 10)));
      const margePct       = ticketRevenue > 0
        ? Math.round((netMargin / ticketRevenue) * 100)
        : 0;
      const route          = routeMap.get(a.routeId);
      const isBlack        = blackSet.has(a.routeId);
      const fillPct        = Math.round(fillRate * 100);
      let conseil: string;
      if (isBlack || margePct < 0) {
        conseil = `Ligne déficitaire sur 90j. Revoir la fréquence ou les coûts d'exploitation.`;
      } else if (fillRate >= 0.85) {
        conseil = `Taux remplissage ${fillPct}% — ligne saturée. Ajouter des départs ou un bus supplémentaire.`;
      } else if (fillRate >= 0.65) {
        conseil = `Taux remplissage ${fillPct}%. Optimiser les créneaux horaires pour capter les pics de demande.`;
      } else {
        conseil = `Remplissage modéré (${fillPct}%). Actions commerciales recommandées pour booster la fréquentation.`;
      }
      return {
        route:        route ? `${route.origin.name} → ${route.destination.name}` : a.routeId,
        score,
        marge:        margePct >= 0 ? `+${margePct}%` : `${margePct}%`,
        fillRate:     fillPct,
        trips:        tripCount,
        conseil,
        isBlackRoute: isBlack,
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Recommandations d'optimisation flotte (90 derniers jours).
   * Génère 3 catégories : rightsizing (capacité vs remplissage), réaffectation
   * (marge négative), maintenance préventive (km élevés).
   */
  async getAiFleet(tenantId: string) {
    try {
      const since = new Date(Date.now() - 90 * AnalyticsService.DAY_MS);

      const busAnalytics = await this.prisma.tripAnalytics.groupBy({
        by:    ['busId'],
        where: { tenantId, tripDate: { gte: since } },
        _avg:  { avgFillRate: true, avgNetMargin: true },
        _sum:  { tripCount: true },
      });

      if (busAnalytics.length === 0) return [];

      const busIds = busAnalytics.map(a => a.busId);
      const buses  = await this.prisma.bus.findMany({
        where:  { id: { in: busIds }, tenantId },
        select: {
          id: true, plateNumber: true, model: true, capacity: true,
          type: true, currentOdometerKm: true,
        },
      });
      const busMap = new Map(buses.map(b => [b.id, b]));
      const advices: {
        id: string; category: 'rightsize' | 'assignment' | 'maintenance';
        vehicle: string; title: string; detail: string; impact: string; score: number;
      }[] = [];

      for (const a of busAnalytics) {
        const bus       = busMap.get(a.busId);
        if (!bus) continue;
        const fillRate  = a._avg.avgFillRate  ?? 0;
        const margin    = a._avg.avgNetMargin ?? 0;
        const trips     = a._sum.tripCount    ?? 0;
        const fillPct   = Math.round(fillRate * 100);

        if (bus.capacity > 35 && fillRate < 0.62) {
          const fuelSave = Math.round((1 - fillRate) * 12);
          advices.push({
            id:       `rightsize-${bus.id}`,
            category: 'rightsize',
            vehicle:  bus.plateNumber,
            title:    `Réduire la capacité — passer à un 30 places`,
            detail:   `Taux remplissage moyen ${fillPct}% sur 90j avec un ${bus.capacity} places. Un bus 30 places couvrirait la demande.`,
            impact:   `+${fuelSave}% économie carburant estimée`,
            score:    Math.min(95, Math.round(85 - fillRate * 50)),
          });
        } else if (margin < 0 && trips >= 5) {
          advices.push({
            id:       `assign-${bus.id}`,
            category: 'assignment',
            vehicle:  bus.plateNumber,
            title:    `Réaffecter sur une ligne rentable`,
            detail:   `Marge nette négative sur 90j. Réaffecter ce bus sur une ligne à fort taux de remplissage optimiserait le ROI.`,
            impact:   `Potentiel +12–18% marge nette`,
            score:    Math.min(90, Math.round(55 + Math.min(25, trips / 3))),
          });
        } else if (bus.currentOdometerKm && bus.currentOdometerKm > 80_000) {
          const kmStr = Math.round(bus.currentOdometerKm).toLocaleString('fr-FR');
          advices.push({
            id:       `maint-${bus.id}`,
            category: 'maintenance',
            vehicle:  bus.plateNumber,
            title:    `Maintenance préventive recommandée`,
            detail:   `${kmStr} km au compteur. Planifier une révision complète pour réduire le risque de panne en route.`,
            impact:   `-15% risque immobilisation non planifiée`,
            score:    Math.min(88, Math.round(55 + Math.min(33, (bus.currentOdometerKm - 80_000) / 5_000))),
          });
        }
      }

      return advices.sort((a, b) => b.score - a.score).slice(0, 8);
    } catch (err) {
      // Résilience : un échec Prisma (schema drift, timeout, groupBy edge-case)
      // ne doit pas casser la page Optimisation flotte. On log + retourne [] —
      // la page affiche l'état "aucune recommandation" et reste navigable.
      this.logger.error(
        `getAiFleet failed for tenant=${tenantId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return [];
    }
  }

  /**
   * Suggestions tarifaires dynamiques (yield management) — 30 derniers jours.
   * Analyse fillRate par route + jour de semaine depuis TripAnalytics.
   * Haute demande (>85%) → hausse modérée. Faible demande (<55%) → baisse.
   * Seuil de confiance minimum 60 — suggestions en dessous exclues.
   */
  async getAiPricing(tenantId: string) {
    try {
      return await this._getAiPricing(tenantId);
    } catch (err) {
      this.logger.error(
        `getAiPricing failed for tenant=${tenantId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return [];
    }
  }

  private async _getAiPricing(tenantId: string) {
    const since = new Date(Date.now() - 30 * AnalyticsService.DAY_MS);
    const DAY_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;

    const analytics = await this.prisma.tripAnalytics.groupBy({
      by:     ['routeId', 'dayOfWeek'],
      where:  { tenantId, tripDate: { gte: since } },
      _avg:   { avgFillRate: true, referencePrice: true },
      _sum:   { tripCount: true },
      having: { tripCount: { _sum: { gte: 3 } } },
    });

    if (analytics.length === 0) return [];

    const routeIds = [...new Set(analytics.map(a => a.routeId))];
    const routes   = await this.prisma.route.findMany({
      where:   { id: { in: routeIds }, tenantId },
      include: {
        origin:      { select: { name: true } },
        destination: { select: { name: true } },
      },
    });
    const routeMap = new Map(routes.map(r => [r.id, r]));
    const suggestions: {
      id: string; route: string; slot: string;
      currentFare: number; suggested: number;
      fillRate: number; revenueImpact: number; confidence: number; rationale: string;
    }[] = [];

    for (const a of analytics) {
      const fillRate   = a._avg.avgFillRate    ?? 0;
      const refPrice   = a._avg.referencePrice ?? 0;
      if (refPrice <= 0) continue;
      const route = routeMap.get(a.routeId);
      if (!route) continue;
      const routeName = `${route.origin.name} → ${route.destination.name}`;
      const day       = DAY_FR[a.dayOfWeek] ?? `J${a.dayOfWeek}`;
      const fillPct   = Math.round(fillRate * 100);
      let suggested: number;
      let revenueImpact: number;
      let confidence: number;
      let rationale: string;

      if (fillRate >= 0.85) {
        const pct  = fillRate >= 0.95 ? 0.15 : 0.10;
        suggested  = Math.round(refPrice * (1 + pct) / 100) * 100;
        revenueImpact = Math.round(pct * 100 * 0.8);
        confidence = Math.round(Math.min(95, fillRate * 105));
        rationale  = `Taux remplissage ${fillPct}% ce jour — forte demande. Hausse modérée absorbée sans perte de volume.`;
      } else if (fillRate <= 0.55) {
        const drop = 0.08 + (0.55 - fillRate) * 0.15;
        suggested  = Math.round(refPrice * (1 - drop) / 100) * 100;
        revenueImpact = Math.round(drop * 100 * 0.55);
        confidence = Math.round(Math.max(60, 75 - (0.55 - fillRate) * 80));
        rationale  = `Taux remplissage ${fillPct}% — faible demande. Réduction attire des voyageurs supplémentaires.`;
      } else {
        continue;
      }

      if (confidence < 60) continue;
      suggestions.push({
        id:           `${a.routeId}-${a.dayOfWeek}`,
        route:        routeName,
        slot:         day,
        currentFare:  Math.round(refPrice),
        suggested,
        fillRate:     fillPct,
        revenueImpact,
        confidence,
        rationale,
      });
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
  }

  /**
   * Rapports périodiques — liste dérivée des données réelles DB (30 derniers jours).
   * Inclut : journaux de caisse clôturés + récapitulatifs mensuels de transactions.
   */
  async getReports(tenantId: string) {
    const since30 = new Date(Date.now() - 30 * AnalyticsService.DAY_MS);
    const since90 = new Date(Date.now() - 90 * AnalyticsService.DAY_MS);

    const [cashCloses, transactions] = await Promise.all([
      this.prisma.cashRegister.findMany({
        where:   { tenantId, status: { in: ['CLOSED', 'DISCREPANCY'] }, closedAt: { gte: since30 } },
        orderBy: { closedAt: 'desc' },
        take:    15,
        select:  { id: true, closedAt: true, finalBalance: true, initialBalance: true, status: true },
      }),
      this.prisma.transaction.findMany({
        where:  { tenantId, createdAt: { gte: since90 } },
        select: { amount: true, createdAt: true },
      }),
    ]);

    const reports: {
      id: string; title: string; period: 'daily' | 'weekly' | 'monthly';
      date: string; amount: number; status: 'ready' | 'discrepancy';
    }[] = [];

    for (const c of cashCloses) {
      if (!c.closedAt) continue;
      const d = c.closedAt;
      const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
      reports.push({
        id:     c.id,
        title:  `Journal de caisse — ${fmt}`,
        period: 'daily',
        date:   this.dayKey(d),
        amount: c.finalBalance ?? 0,
        status: c.status === 'DISCREPANCY' ? 'discrepancy' : 'ready',
      });
    }

    // Monthly revenue summaries from transactions (last 3 months)
    const byMonth = new Map<string, number>();
    for (const tx of transactions) {
      const month = tx.createdAt.toISOString().slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + tx.amount);
    }
    for (const [month, total] of [...byMonth.entries()].sort().reverse().slice(0, 3)) {
      reports.push({
        id:     `monthly-${month}`,
        title:  `Récapitulatif mensuel — ${month}`,
        period: 'monthly',
        date:   `${month}-01`,
        amount: total,
        status: 'ready',
      });
    }

    return reports.sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Top routes par revenu sur une période.
   */
  async getTopRoutes(tenantId: string, from: Date, to: Date, limit = 10) {
    const trips = await this.prisma.trip.findMany({
      where:   { tenantId, departureScheduled: { gte: from, lte: to }, status: 'COMPLETED' },
      include: { route: true, travelers: true },
    });

    const byRoute = new Map<string, { routeName: string; trips: number; passengers: number }>();
    for (const trip of trips) {
      const key = trip.routeId;
      const cur = byRoute.get(key) ?? { routeName: trip.route.name, trips: 0, passengers: 0 };
      cur.trips++;
      cur.passengers += trip.travelers.length;
      byRoute.set(key, cur);
    }

    return [...byRoute.entries()]
      .map(([routeId, v]) => ({ routeId, ...v }))
      .sort((a, b) => b.passengers - a.passengers)
      .slice(0, limit);
  }
}
