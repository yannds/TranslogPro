import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

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
