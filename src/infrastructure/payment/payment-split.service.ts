/**
 * PaymentSplitService — calcul du plan de split commission SaaS.
 *
 * Source de vérité :
 *   - PlatformPaymentConfig (singleton) : commission par défaut + payout plateforme
 *   - TenantPaymentConfig (par tenant)   : payout transporteur + override commission négocié
 *
 * Contrat :
 *   - Devise = celle du paiement principal (PaymentIntent.currency).
 *   - Pas de magic number : tout vient de la DB. Si la DB est vide, défauts
 *     du schema Prisma (300 bps = 3%, FLAT 0).
 *   - Arithmétique entière (Math.round) — XAF/XOF n'ont pas de centimes.
 *   - tenantAmount = amount - platformAmount (jamais l'inverse, pour éviter
 *     les divergences de centimes).
 *   - Si platformAmount ≥ amount, on cap à amount-1 (la plateforme n'absorbe
 *     pas tout — sécurité contre erreur de config "FLAT 100000 sur ticket 50").
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PaymentSplit } from './interfaces/payment.interface';

@Injectable()
export class PaymentSplitService {
  private readonly logger = new Logger(PaymentSplitService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcule le plan de split pour un encaissement donné. Retourne null si
   * la commission plateforme est désactivée (bps=0 et flat=0) — dans ce cas
   * l'orchestrator n'envoie aucun objet split au provider.
   */
  async computeSplit(args: {
    tenantId: string;
    amount:   number;
  }): Promise<PaymentSplit | null> {
    const platform = await this.prisma.platformPaymentConfig.upsert({
      where:  { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });

    const tenant = await this.prisma.tenantPaymentConfig.findUnique({
      where: { tenantId: args.tenantId },
      select: {
        payoutSubaccountId:     true,
        platformFeeBpsOverride: true,
      },
    });

    const effectiveBps =
      tenant?.platformFeeBpsOverride ?? platform.platformFeeBps;
    const flat = platform.platformFeeFlatMinor;

    if (effectiveBps <= 0 && flat <= 0) return null;

    let platformAmount: number;
    let policyTrace:    string;
    if (platform.platformFeePolicy === 'FLAT') {
      platformAmount = flat;
      policyTrace    = `FLAT ${flat}`;
    } else {
      // PERCENT (default)
      const percentPart = Math.round((args.amount * effectiveBps) / 10_000);
      platformAmount = percentPart + flat;
      policyTrace    = `PERCENT bps=${effectiveBps}` +
                       (flat > 0 ? ` + flat=${flat}` : '') +
                       (tenant?.platformFeeBpsOverride != null ? ' (override)' : '');
    }

    // Sécurité : la plateforme ne peut JAMAIS absorber tout le paiement.
    // En XAF, on garde au moins 1 unité pour le tenant.
    if (platformAmount >= args.amount) {
      this.logger.warn(
        `[Split] platformAmount=${platformAmount} >= amount=${args.amount} ` +
        `(policy=${policyTrace}) → cap à amount-1 pour tenant ${args.tenantId}`,
      );
      platformAmount = Math.max(0, args.amount - 1);
    }

    const tenantAmount = args.amount - platformAmount;

    return {
      platformAmount,
      tenantAmount,
      tenantSubaccountId:   tenant?.payoutSubaccountId ?? undefined,
      platformSubaccountId: platform.platformPayoutSubaccountId ?? undefined,
      policyTrace,
    };
  }
}
