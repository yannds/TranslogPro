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

  // ── Prévisions de demande — page /admin/ai-demand ───────────────────────────

  /**
   * Prévisions de demande par ligne + horizon (7/14/30 jours).
   *
   * Méthode :
   *   - forecast : moyenne mobile par day-of-week sur 90 derniers jours (seasonality
   *     hebdomadaire capturée). Projette ensuite N jours sur les mêmes DOW.
   *   - lineForecasts : top 5 routes (30j) avec next7 projeté, trend vs 30j précédents,
   *     peak heure/jour détectés.
   *   - events : jours fériés sur l'horizon + weekends prolongés.
   *
   * Source : Ticket.createdAt (proxy de la demande historique) + Trip.departureDate
   *          pour détecter les peaks d'offre (créneaux à forte pression attendue).
   */
  async getAiDemand(tenantId: string, horizon: '7d' | '14d' | '30d') {
    try {
      return await this._getAiDemand(tenantId, horizon);
    } catch (err) {
      this.logger.error(
        `getAiDemand failed for tenant=${tenantId} horizon=${horizon}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return { forecast: [], lineForecasts: [], events: [] };
    }
  }

  private async _getAiDemand(tenantId: string, horizon: '7d' | '14d' | '30d') {
    const DAY_MS_LOCAL      = AnalyticsService.DAY_MS;
    const HISTORY_DAYS      = 90;
    const TOP_LINES         = 5;
    const horizonDays       = horizon === '7d' ? 7 : horizon === '14d' ? 14 : 30;

    const now          = new Date();
    const historyStart = new Date(now.getTime() - HISTORY_DAYS * DAY_MS_LOCAL);
    const recent30     = new Date(now.getTime() - 30 * DAY_MS_LOCAL);
    const prev30       = new Date(now.getTime() - 60 * DAY_MS_LOCAL);

    const [ticketsHist, ticketsRecent, ticketsPrev, tenant] = await Promise.all([
      this.prisma.ticket.findMany({
        where:  { tenantId, createdAt: { gte: historyStart } },
        select: { createdAt: true },
      }),
      this.prisma.ticket.findMany({
        where:  { tenantId, createdAt: { gte: recent30 } },
        select: { createdAt: true,
                  boardingStation:  { select: { name: true } },
                  alightingStation: { select: { name: true } } },
      }),
      this.prisma.ticket.findMany({
        where:  { tenantId, createdAt: { gte: prev30, lt: recent30 } },
        select: { boardingStation:  { select: { name: true } },
                  alightingStation: { select: { name: true } } },
      }),
      this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { country: true },
      }),
    ]);

    // ── 1. Forecast : moyenne par day-of-week ────────────────────────────────
    const counts = new Map<string, number[]>(); // key = DOW (0..6) → [count par occurrence]
    const DOW_LABELS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] as const;
    // Bucketize par (jour, DOW)
    const dayBuckets = new Map<string, { dow: number; count: number }>();
    for (const t of ticketsHist) {
      const d    = new Date(t.createdAt);
      const key  = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      const bucket = dayBuckets.get(key) ?? { dow: d.getDay(), count: 0 };
      bucket.count += 1;
      dayBuckets.set(key, bucket);
    }
    for (const { dow, count } of dayBuckets.values()) {
      const arr = counts.get(String(dow)) ?? [];
      arr.push(count);
      counts.set(String(dow), arr);
    }
    const avgByDow = new Map<number, number>();
    for (const [dowStr, arr] of counts.entries()) {
      const avg = arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);
      avgByDow.set(Number(dowStr), avg);
    }

    const forecast = Array.from({ length: horizonDays }, (_, i) => {
      const d      = new Date(now.getTime() + (i + 1) * DAY_MS_LOCAL);
      const dow    = d.getDay();
      const value  = Math.round(avgByDow.get(dow) ?? 0);
      const label  = horizon === '7d'
        ? DOW_LABELS_FR[dow]
        : horizon === '14d' ? `J${i + 1}` : `${i + 1}`;
      return { label, value };
    });

    // ── 2. Line forecasts : top 5 routes + trend 30j vs 30j précédent ────────
    const toKey = (t: any) =>
      `${t.boardingStation?.name ?? '—'} → ${t.alightingStation?.name ?? '—'}`;
    const recentByLine = new Map<string, Date[]>();
    for (const t of ticketsRecent) {
      const k = toKey(t);
      const arr = recentByLine.get(k) ?? [];
      arr.push(new Date(t.createdAt));
      recentByLine.set(k, arr);
    }
    const prevByLine = new Map<string, number>();
    for (const t of ticketsPrev) {
      const k = toKey(t);
      prevByLine.set(k, (prevByLine.get(k) ?? 0) + 1);
    }

    const lineForecasts = [...recentByLine.entries()]
      .map(([route, dates]) => {
        const count30Recent = dates.length;
        const count30Prev   = prevByLine.get(route) ?? 0;
        const next7 = Math.round((count30Recent / 30) * 7);
        const trend = count30Prev === 0
          ? (count30Recent > 0 ? 100 : 0)
          : Math.round(((count30Recent - count30Prev) / count30Prev) * 1_000) / 10;

        // Peak : jour+heure le plus fréquent
        const hourBuckets = new Map<string, number>();
        for (const d of dates) {
          const key = `${DOW_LABELS_FR[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}h`;
          hourBuckets.set(key, (hourBuckets.get(key) ?? 0) + 1);
        }
        const peak = [...hourBuckets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

        const note = trend >= 10
          ? 'Demande en hausse — anticiper un départ supplémentaire.'
          : trend <= -10
            ? 'Demande en baisse — revoir la fréquence.'
            : 'Demande stable sur la période.';

        return { route, next7, trend, peak, note };
      })
      .sort((a, b) => b.next7 - a.next7)
      .slice(0, TOP_LINES);

    // ── 3. Events : jours fériés + weekends prolongés sur l'horizon ──────────
    const country = tenant?.country ?? 'CG';
    const events = this.buildHolidayEvents(country, now, horizonDays);

    return { forecast, lineForecasts, events };
  }

  /**
   * Jours fériés simplifiés par pays. À terme : externaliser dans un micro-service
   * ou un package (date-holidays) ; pour l'instant table embarquée suffit.
   * Format : { date: 'DD MMM' (FR locale), label: string, level: 'high'|'med'|'low' }.
   */
  private buildHolidayEvents(
    country:     string,
    from:        Date,
    horizonDays: number,
  ): { date: string; label: string; level: 'high' | 'med' | 'low' }[] {
    // Table minimale — à étendre progressivement. Les dates sont (month, day) JS :
    // month = 0-indexed.
    const PUBLIC_HOLIDAYS: Record<string, { m: number; d: number; label: string; level: 'high' | 'med' | 'low' }[]> = {
      CG: [
        { m: 4,  d: 1,  label: 'Fête du Travail',            level: 'med'  },
        { m: 6,  d: 15, label: 'Fête de l\'Indépendance CG', level: 'high' },
        { m: 7,  d: 15, label: 'Jour de l\'Armée',           level: 'low'  },
        { m: 10, d: 1,  label: 'Toussaint',                  level: 'med'  },
        { m: 11, d: 25, label: 'Noël',                       level: 'high' },
      ],
      SN: [
        { m: 3,  d: 4,  label: 'Fête de l\'Indépendance SN', level: 'high' },
        { m: 4,  d: 1,  label: 'Fête du Travail',            level: 'med'  },
        { m: 10, d: 1,  label: 'Toussaint',                  level: 'med'  },
        { m: 11, d: 25, label: 'Noël',                       level: 'high' },
      ],
      CI: [
        { m: 4,  d: 1,  label: 'Fête du Travail',            level: 'med'  },
        { m: 7,  d: 7,  label: 'Fête de l\'Indépendance CI', level: 'high' },
        { m: 11, d: 25, label: 'Noël',                       level: 'high' },
      ],
      FR: [
        { m: 4,  d: 1,  label: 'Fête du Travail',     level: 'med'  },
        { m: 4,  d: 8,  label: 'Victoire 1945',       level: 'low'  },
        { m: 6,  d: 14, label: 'Fête Nationale',      level: 'high' },
        { m: 10, d: 1,  label: 'Toussaint',           level: 'med'  },
        { m: 11, d: 25, label: 'Noël',                level: 'high' },
      ],
    };

    const list = PUBLIC_HOLIDAYS[country] ?? PUBLIC_HOLIDAYS['CG'];
    const to   = new Date(from.getTime() + horizonDays * AnalyticsService.DAY_MS);
    const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
                       'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

    const events: { date: string; label: string; level: 'high' | 'med' | 'low' }[] = [];
    // Envisager l'année courante ET l'année suivante pour les horizons qui
    // franchissent un changement d'année.
    for (const year of [from.getFullYear(), from.getFullYear() + 1]) {
      for (const h of list) {
        const hDate = new Date(year, h.m, h.d);
        if (hDate >= from && hDate <= to) {
          events.push({
            date:  `${String(hDate.getDate()).padStart(2, '0')} ${MONTHS_FR[h.m]}`,
            label: h.label,
            level: h.level,
          });
        }
      }
    }
    return events.sort((a, b) => a.date.localeCompare(b.date));
  }

  // ── Tableaux analytiques — page /admin/analytics ─────────────────────────────

  /**
   * Dashboard analytique tenant — séries temporelles + breakdowns + mini-KPIs.
   * Remplace les arrays mock côté front (REVENUE / PASSENGERS_BY_LINE /
   * TICKETS_BY_CHANNEL / PARCELS_BY_WEIGHT / MINI_KPIS).
   *
   * Périodes supportées :
   *   - 7d  → 7 buckets journaliers
   *   - 30d → 30 buckets journaliers
   *   - 90d → 12 buckets hebdomadaires
   *
   * Devise : lue depuis Tenant.currency (jamais hardcodée).
   * Tenant isolation : tenantId en WHERE racine sur chaque requête.
   */
  async getAnalyticsBoard(tenantId: string, period: '7d' | '30d' | '90d') {
    try {
      return await this._getAnalyticsBoard(tenantId, period);
    } catch (err) {
      this.logger.error(
        `getAnalyticsBoard failed for tenant=${tenantId} period=${period}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return {
        currency:           'XAF',
        revenue:            [],
        passengersByLine:   [],
        ticketsByChannel:   [],
        parcelsByWeight:    [],
        miniKpis:           { caTotal: 0, travelers: 0, parcels: 0, fillRate: 0,
                              caDelta: 0, travelersDelta: 0, parcelsDelta: 0, fillRateDelta: 0 },
      };
    }
  }

  private async _getAnalyticsBoard(tenantId: string, period: '7d' | '30d' | '90d') {
    const DAY_MS_LOCAL    = AnalyticsService.DAY_MS;
    const days            = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const isWeeklyBucket  = period === '90d';
    const bucketDays      = isWeeklyBucket ? 7 : 1;
    const nBuckets        = isWeeklyBucket ? 12 : days;

    const endDate       = new Date();
    const startDate     = new Date(endDate.getTime() - days * DAY_MS_LOCAL);
    const prevStartDate = new Date(startDate.getTime() - days * DAY_MS_LOCAL);

    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { currency: true },
    });
    const currency = tenant?.currency ?? 'XAF';

    const [
      transactionsPeriod,
      transactionsPrev,
      ticketsPeriod,
      ticketsPrev,
      parcelsPeriod,
      parcelsPrev,
      tripsPeriod,
    ] = await Promise.all([
      this.prisma.transaction.findMany({
        where:  { tenantId, createdAt: { gte: startDate, lt: endDate },
                  type: { in: ['TICKET', 'PARCEL', 'LUGGAGE_FEE'] } },
        select: { amount: true, createdAt: true },
      }),
      this.prisma.transaction.aggregate({
        where: { tenantId, createdAt: { gte: prevStartDate, lt: startDate },
                 type: { in: ['TICKET', 'PARCEL', 'LUGGAGE_FEE'] } },
        _sum:  { amount: true },
      }),
      this.prisma.ticket.findMany({
        where:  { tenantId, createdAt: { gte: startDate, lt: endDate } },
        select: { agencyId: true,
                  boardingStation: { select: { name: true } },
                  alightingStation: { select: { name: true } } },
      }),
      this.prisma.ticket.count({
        where: { tenantId, createdAt: { gte: prevStartDate, lt: startDate } },
      }),
      this.prisma.parcel.findMany({
        where:  { tenantId, createdAt: { gte: startDate, lt: endDate } },
        select: { weight: true },
      }),
      this.prisma.parcel.count({
        where: { tenantId, createdAt: { gte: prevStartDate, lt: startDate } },
      }),
      this.prisma.tripAnalytics.aggregate({
        where: { tenantId, tripDate: { gte: startDate, lt: endDate } },
        _avg:  { avgFillRate: true },
      }),
    ]);

    // ── 1. Revenue time-series ────────────────────────────────────────────────
    const revenueBuckets = new Array<number>(nBuckets).fill(0);
    for (const tx of transactionsPeriod) {
      const age       = endDate.getTime() - new Date(tx.createdAt).getTime();
      const ageDays   = Math.floor(age / DAY_MS_LOCAL);
      const bucketIdx = nBuckets - 1 - Math.floor(ageDays / bucketDays);
      if (bucketIdx >= 0 && bucketIdx < nBuckets) {
        revenueBuckets[bucketIdx] += tx.amount;
      }
    }
    const DOW_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] as const;
    const revenue = revenueBuckets.map((v, i) => {
      let label: string;
      if (period === '7d') {
        const d = new Date(endDate.getTime() - (nBuckets - 1 - i) * DAY_MS_LOCAL);
        label = DOW_LABELS[d.getDay()];
      } else if (period === '30d') {
        label = `J${i + 1}`;
      } else {
        label = `S${i + 1}`;
      }
      // Valeur en millions d'unités monétaires (cohérent avec l'UX historique).
      return { label, value: Math.round(v / 100_000) / 10 };
    });

    // ── 2. Passengers by line (top 5) ────────────────────────────────────────
    const byLine = new Map<string, number>();
    for (const t of ticketsPeriod) {
      const origin = t.boardingStation?.name  ?? '—';
      const dest   = t.alightingStation?.name ?? '—';
      const key    = `${origin}↔${dest}`;
      byLine.set(key, (byLine.get(key) ?? 0) + 1);
    }
    const passengersByLine = [...byLine.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, value]) => ({ label, value }));

    // ── 3. Tickets by channel ────────────────────────────────────────────────
    const ticketsTotal   = ticketsPeriod.length;
    const ticketsGuichet = ticketsPeriod.filter(t => t.agencyId != null).length;
    const ticketsOnline  = ticketsTotal - ticketsGuichet;
    const ticketsByChannel = ticketsTotal === 0 ? [] : [
      { label: 'Guichet', value: Math.round((ticketsGuichet / ticketsTotal) * 100) },
      { label: 'En ligne', value: Math.round((ticketsOnline  / ticketsTotal) * 100) },
    ];

    // ── 4. Parcels by weight ─────────────────────────────────────────────────
    const parcelsTotal = parcelsPeriod.length;
    const WEIGHT_BUCKETS = [
      { label: '<5kg',    max: 5   },
      { label: '5–20kg',  max: 20  },
      { label: '20–50kg', max: 50  },
      { label: '>50kg',   max: Infinity },
    ] as const;
    const weightCounts = WEIGHT_BUCKETS.map(b => ({ label: b.label, count: 0 }));
    for (const p of parcelsPeriod) {
      const bIdx = WEIGHT_BUCKETS.findIndex(b => p.weight < b.max);
      if (bIdx >= 0) weightCounts[bIdx].count += 1;
    }
    const parcelsByWeight = parcelsTotal === 0 ? [] :
      weightCounts.map(w => ({ label: w.label, value: Math.round((w.count / parcelsTotal) * 100) }));

    // ── 5. Mini-KPIs + deltas (% vs période précédente) ─────────────────────
    const caTotal        = transactionsPeriod.reduce((s, t) => s + t.amount, 0);
    const caPrev         = transactionsPrev._sum.amount ?? 0;
    const travelers      = ticketsPeriod.length;
    const travelersPrev  = ticketsPrev;
    const parcels        = parcelsPeriod.length;
    const parcelsPrevC   = parcelsPrev;
    const fillRate       = Math.round((tripsPeriod._avg.avgFillRate ?? 0) * 100);
    const pctDelta = (cur: number, prev: number) =>
      prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1_000) / 10;

    const miniKpis = {
      caTotal,
      travelers,
      parcels,
      fillRate,
      caDelta:         pctDelta(caTotal,       caPrev),
      travelersDelta:  pctDelta(travelers,     travelersPrev),
      parcelsDelta:    pctDelta(parcels,       parcelsPrevC),
      fillRateDelta:   0, // fillRate absolu, delta moins pertinent à court terme
    };

    return { currency, revenue, passengersByLine, ticketsByChannel, parcelsByWeight, miniKpis };
  }
}
