import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface RefundCalculation {
  originalAmount: number;
  refundPercent:  number;
  refundAmount:   number;
  departureAt:    Date;
  currency:       string;
}

@Injectable()
export class CancellationPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcule le montant remboursable pour un billet donné en appliquant
   * la politique d'annulation du tenant (TenantBusinessConfig).
   *
   * Paliers :
   *   ≥ cancellationFullRefundMinutes    → 100 %
   *   ≥ cancellationPartialRefundMinutes → cancellationPartialRefundPct
   *   < cancellationPartialRefundMinutes → 0 % (non remboursable)
   */
  async calculateRefundAmount(
    tenantId: string,
    ticketId: string,
  ): Promise<RefundCalculation> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);

    const trip = await this.prisma.trip.findFirst({
      where: { id: ticket.tripId, tenantId },
    });
    if (!trip) throw new NotFoundException(`Trip ${ticket.tripId} not found`);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currency: true },
    });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

    const config = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId },
    });
    if (!config) throw new NotFoundException(`TenantBusinessConfig missing for ${tenantId}`);

    const departureAt = trip.departureScheduled;
    const minutesBefore = (departureAt.getTime() - Date.now()) / 60_000;

    let refundPercent: number;
    if (minutesBefore >= config.cancellationFullRefundMinutes) {
      refundPercent = 1.0;
    } else if (minutesBefore >= config.cancellationPartialRefundMinutes) {
      refundPercent = config.cancellationPartialRefundPct;
    } else {
      refundPercent = 0;
    }

    const originalAmount = ticket.pricePaid;
    const refundAmount   = Math.round(originalAmount * refundPercent * 100) / 100;

    return {
      originalAmount,
      refundPercent,
      refundAmount,
      departureAt,
      currency: tenant.currency,
    };
  }
}
