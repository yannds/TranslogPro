/**
 * PlatformPaymentService — config plateforme paiement (singleton).
 *
 * Source de vérité pour :
 *   - Commission par défaut sur chaque transaction tenant (platformFeeBps)
 *   - Compte de retrait commission plateforme (numéro MoMo perso ou subaccount)
 *   - Paramètres globaux paiement (grace period PAST_DUE, retries webhook…)
 *
 * Une seule ligne en DB (id='singleton'). Upsert idempotent au premier accès.
 * Édité depuis l'UI Platform Settings → Paiements par un super-admin.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface UpdatePlatformPaymentConfigDto {
  // Paramètres globaux opérationnels
  pastDueGraceHours?:             number;
  globalWebhookRetryMax?:         number;
  webhookRetryInitialBackoffSec?: number;
  reconciliationCronEnabled?:     boolean;
  reconciliationLagMinutes?:      number;
  alertEmailOnGhostPayment?:      string | null;
  // Commission plateforme (split SaaS)
  platformFeeBps?:                number;
  platformFeePolicy?:             string;  // PERCENT | FLAT
  platformFeeFlatMinor?:          number;
  // Compte de retrait commission
  platformPayoutMethod?:          string;  // AGGREGATOR_MAIN | MOBILE_MONEY | SUBACCOUNT | BANK
  platformPayoutPhoneE164?:       string | null;
  platformPayoutSubaccountId?:    string | null;
  platformPayoutAccountName?:     string | null;
}

@Injectable()
export class PlatformPaymentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lecture idempotente (upsert si absent — première lecture après seed). */
  async get() {
    return this.prisma.platformPaymentConfig.upsert({
      where:  { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });
  }

  async update(dto: UpdatePlatformPaymentConfigDto) {
    await this.get(); // garantit l'existence
    return this.prisma.platformPaymentConfig.update({
      where: { id: 'singleton' },
      data:  {
        ...('pastDueGraceHours'             in dto ? { pastDueGraceHours:             dto.pastDueGraceHours! } : {}),
        ...('globalWebhookRetryMax'         in dto ? { globalWebhookRetryMax:         dto.globalWebhookRetryMax! } : {}),
        ...('webhookRetryInitialBackoffSec' in dto ? { webhookRetryInitialBackoffSec: dto.webhookRetryInitialBackoffSec! } : {}),
        ...('reconciliationCronEnabled'     in dto ? { reconciliationCronEnabled:     dto.reconciliationCronEnabled! } : {}),
        ...('reconciliationLagMinutes'      in dto ? { reconciliationLagMinutes:      dto.reconciliationLagMinutes! } : {}),
        ...('alertEmailOnGhostPayment'      in dto ? { alertEmailOnGhostPayment:      dto.alertEmailOnGhostPayment } : {}),
        ...('platformFeeBps'                in dto ? { platformFeeBps:                dto.platformFeeBps! } : {}),
        ...('platformFeePolicy'             in dto ? { platformFeePolicy:             dto.platformFeePolicy! } : {}),
        ...('platformFeeFlatMinor'          in dto ? { platformFeeFlatMinor:          dto.platformFeeFlatMinor! } : {}),
        ...('platformPayoutMethod'          in dto ? { platformPayoutMethod:          dto.platformPayoutMethod! } : {}),
        ...('platformPayoutPhoneE164'       in dto ? { platformPayoutPhoneE164:       dto.platformPayoutPhoneE164 } : {}),
        ...('platformPayoutSubaccountId'    in dto ? { platformPayoutSubaccountId:    dto.platformPayoutSubaccountId } : {}),
        ...('platformPayoutAccountName'     in dto ? { platformPayoutAccountName:     dto.platformPayoutAccountName } : {}),
      },
    });
  }

  /**
   * Override de commission négocié pour un tenant donné (deals enterprise).
   * Réservé super-admin — non exposé via les endpoints tenant.
   */
  async setTenantFeeOverride(tenantId: string, bpsOrNull: number | null) {
    return this.prisma.tenantPaymentConfig.upsert({
      where:  { tenantId },
      create: { tenantId, platformFeeBpsOverride: bpsOrNull },
      update: { platformFeeBpsOverride: bpsOrNull },
    });
  }
}
