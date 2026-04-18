import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { normalizePhone } from '../../common/helpers/phone.helper';

/**
 * CustomerRecommendationService — Phase 4 CRM.
 *
 * Dérive à la volée les préférences d'un Customer à partir de son historique
 * (tickets + colis). Pas de persistance : les recommandations sont recalculées
 * à chaque appel pour toujours refléter l'état courant. Ça évite un schéma
 * Customer.preferences rigide qui se désynchroniserait.
 *
 * Objectifs :
 *   - Pré-remplir le siège habituel en caisse → gain d'attention.
 *   - Proposer la classe tarifaire fréquente → up-sell naturel.
 *   - Suggérer la route favorite → auto-complétion colis.
 *
 * Isolation tenant stricte : toutes les queries scopées par tenantId.
 * Pas de fuite cross-tenant possible.
 */

export interface Recommendation {
  customerId:       string;
  totalTickets:     number;
  totalParcels:     number;
  isRecurrent:      boolean;   // ≥2 transactions
  topSeat:          string | null;
  topFareClass:     string | null;
  topBoardingId:    string | null;
  topAlightingId:   string | null;
  topDestinationId: string | null;   // pour colis
  language:         string | null;
  segments:         string[];
}

@Injectable()
export class CustomerRecommendationService {
  constructor(private readonly prisma: PrismaService) {}

  async byCustomer(tenantId: string, customerId: string): Promise<Recommendation> {
    const customer = await this.prisma.customer.findFirst({
      where:  { tenantId, id: customerId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('customer_not_found');
    return this.computeFor(tenantId, customer);
  }

  async byPhone(tenantId: string, rawPhone: string): Promise<Recommendation | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }, select: { country: true },
    });
    const r = normalizePhone(rawPhone, tenant?.country ?? null);
    if (!r.ok) return null;

    const customer = await this.prisma.customer.findFirst({
      where: { tenantId, phoneE164: r.e164, deletedAt: null },
    });
    if (!customer) return null;
    return this.computeFor(tenantId, customer);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async computeFor(
    tenantId: string,
    customer: { id: string; language: string | null; totalTickets: number; totalParcels: number; segments: string[] },
  ): Promise<Recommendation> {
    const [tickets, parcelsSent] = await Promise.all([
      this.prisma.ticket.findMany({
        where: {
          tenantId, customerId: customer.id,
          status: { notIn: ['CANCELLED', 'EXPIRED'] },
        },
        select: { seatNumber: true, fareClass: true, boardingStationId: true, alightingStationId: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.parcel.findMany({
        where: { tenantId, senderCustomerId: customer.id },
        select: { destinationId: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    return {
      customerId:       customer.id,
      totalTickets:     customer.totalTickets,
      totalParcels:     customer.totalParcels,
      isRecurrent:      customer.totalTickets + customer.totalParcels >= 2,
      topSeat:          this.topOf(tickets.map(t => t.seatNumber).filter((s): s is string => !!s)),
      topFareClass:     this.topOf(tickets.map(t => t.fareClass)),
      topBoardingId:    this.topOf(tickets.map(t => t.boardingStationId)),
      topAlightingId:   this.topOf(tickets.map(t => t.alightingStationId)),
      topDestinationId: this.topOf(parcelsSent.map(p => p.destinationId)),
      language:         customer.language,
      segments:         customer.segments ?? [],
    };
  }

  /** Retourne la valeur la plus fréquente dans le tableau, ou null si vide. */
  private topOf<T>(arr: T[]): T | null {
    if (arr.length === 0) return null;
    const counts = new Map<T, number>();
    for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best: T | null = null;
    let max = 0;
    for (const [k, n] of counts) {
      if (n > max) { best = k; max = n; }
    }
    return best;
  }
}
