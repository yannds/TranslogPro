import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * CustomerSegmentService — Phase 5 CRM.
 *
 * Calcule les segments d'un Customer à partir de ses compteurs et timings.
 * Met à jour `Customer.segments[]` en base.
 *
 * Segments calculés automatiquement :
 *   - VIP        : totalSpentCents >= VIP_THRESHOLD_CENTS (seuil tenant, défaut 500 000 cents)
 *   - FREQUENT   : totalTickets + totalParcels >= 5
 *   - NEW        : firstSeenAt < 30 jours
 *   - DORMANT    : lastSeenAt   > 90 jours (éligible réactivation)
 *
 * Segments manuels (non touchés par ce service) :
 *   - CORPORATE  : flag commercial tenant-admin
 *   - Tout autre label libre posé par un manager.
 *
 * Contrat :
 *   - Idempotent, re-exécutable sans effet secondaire.
 *   - Préserve les segments manuels (tout ce qui n'est pas dans MANAGED_SEGMENTS).
 *   - Pas de trigger temps-réel (coût event bus) → recomputeForCustomer() appelé
 *     à chaque `resolveOrCreate` (gratuit car déjà en tx) + endpoint batch pour
 *     un recalcul global.
 */

const MANAGED_SEGMENTS = ['VIP', 'FREQUENT', 'NEW', 'DORMANT'] as const;
const FREQUENT_MIN_TRANSACTIONS = 5;
const VIP_THRESHOLD_CENTS       = 500_000n;  // 5 000 unités de devise
const NEW_WINDOW_MS             = 30 * 24 * 3600_000;
const DORMANT_WINDOW_MS         = 90 * 24 * 3600_000;

@Injectable()
export class CustomerSegmentService {
  private readonly logger = new Logger(CustomerSegmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recalcule les segments auto d'un Customer donné.
   * Préserve les segments manuels non gérés.
   */
  async recomputeForCustomer(
    tenantId:   string,
    customerId: string,
    tx?:        { customer: { findFirst: Function; update: Function } },
  ): Promise<string[]> {
    const db = (tx ?? this.prisma) as unknown as typeof this.prisma;

    const customer = await db.customer.findFirst({
      where:  { tenantId, id: customerId, deletedAt: null },
      select: {
        id: true, totalTickets: true, totalParcels: true,
        totalSpentCents: true, firstSeenAt: true, lastSeenAt: true,
        segments: true,
      },
    });
    if (!customer) return [];

    const next = this.computeSegments(customer);

    // Merge : conserver les segments manuels + ajouter/retirer les managed
    const manual = (customer.segments ?? []).filter(s => !MANAGED_SEGMENTS.includes(s as any));
    const merged = [...new Set([...manual, ...next])];

    // Si identique, on skip l'update
    const same = merged.length === (customer.segments ?? []).length
      && merged.every(s => (customer.segments ?? []).includes(s));
    if (same) return merged;

    await db.customer.update({
      where: { id: customerId },
      data:  { segments: merged },
    });
    return merged;
  }

  /**
   * Recalcule pour tous les Customers d'un tenant. Batch utile pour migration
   * ou rattrapage quotidien. Renvoie le nombre mis à jour.
   */
  async recomputeForTenant(tenantId: string): Promise<{ scanned: number; updated: number }> {
    const customers = await this.prisma.customer.findMany({
      where:  { tenantId, deletedAt: null },
      select: {
        id: true, totalTickets: true, totalParcels: true,
        totalSpentCents: true, firstSeenAt: true, lastSeenAt: true,
        segments: true,
      },
    });

    let updated = 0;
    for (const c of customers) {
      const next = this.computeSegments(c);
      const manual = (c.segments ?? []).filter(s => !MANAGED_SEGMENTS.includes(s as any));
      const merged = [...new Set([...manual, ...next])];

      const same = merged.length === (c.segments ?? []).length
        && merged.every(s => (c.segments ?? []).includes(s));
      if (!same) {
        await this.prisma.customer.update({
          where: { id: c.id },
          data:  { segments: merged },
        });
        updated++;
      }
    }
    return { scanned: customers.length, updated };
  }

  /** Règles de segmentation — pures, facilement testables. */
  computeSegments(input: {
    totalTickets:    number;
    totalParcels:    number;
    totalSpentCents: bigint;
    firstSeenAt:     Date;
    lastSeenAt:      Date;
  }): string[] {
    const out: string[] = [];
    const now = Date.now();

    if (input.totalSpentCents >= VIP_THRESHOLD_CENTS) out.push('VIP');
    if (input.totalTickets + input.totalParcels >= FREQUENT_MIN_TRANSACTIONS) out.push('FREQUENT');
    if (now - new Date(input.firstSeenAt).getTime() < NEW_WINDOW_MS) out.push('NEW');
    if (now - new Date(input.lastSeenAt).getTime()  > DORMANT_WINDOW_MS) out.push('DORMANT');

    return out;
  }
}
