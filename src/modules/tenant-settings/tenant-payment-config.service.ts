import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * TenantPaymentConfigService — lecture / mise à jour de la config paiement tenant.
 *
 * Chaque tenant a 1 ligne (upsert au provisioning). On ne supprime jamais.
 */

export interface UpdatePaymentConfigDto {
  defaultProviderByMethod?: Record<string, string>;
  fallbackChainByMethod?:   Record<string, string[]>;
  minAmountByMethod?:       Record<string, number>;
  maxAmountByMethod?:       Record<string, number>;
  allowedCurrencies?:       string[];
  intentTtlMinutes?:        number;
  momoPushTimeoutSeconds?:  number;
  webhookRetryMaxAttempts?: number;
  reconciliationLagMinutes?: number;
  passProviderFeesToCustomer?: boolean;
  surchargePercentByMethod?: Record<string, number>;
  requireCustomerEmailFor?: string[];
  allowGuestCheckout?:      boolean;
  refundMfaThreshold?:      number;
  // Compte de retrait du transporteur (où arrive sa part de chaque ticket).
  payoutMethod?:            string;  // MOBILE_MONEY | SUBACCOUNT | BANK
  payoutPhoneE164?:         string | null;
  payoutSubaccountId?:      string | null;
  payoutAccountName?:       string | null;
  // platformFeeBpsOverride n'est PAS exposé côté tenant — réservé super-admin
  // pour des deals négociés. Géré uniquement via PlatformPaymentService.
}

@Injectable()
export class TenantPaymentConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, currency: true } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} introuvable`);
    return this.prisma.tenantPaymentConfig.upsert({
      where:  { tenantId },
      create: { tenantId, allowedCurrencies: [tenant.currency] },
      update: {},
    });
  }

  async update(tenantId: string, dto: UpdatePaymentConfigDto) {
    await this.get(tenantId); // garantit l'existence
    return this.prisma.tenantPaymentConfig.update({
      where: { tenantId },
      data:  {
        ...('defaultProviderByMethod' in dto ? { defaultProviderByMethod: dto.defaultProviderByMethod as object } : {}),
        ...('fallbackChainByMethod'   in dto ? { fallbackChainByMethod:   dto.fallbackChainByMethod   as object } : {}),
        ...('minAmountByMethod'       in dto ? { minAmountByMethod:       dto.minAmountByMethod       as object } : {}),
        ...('maxAmountByMethod'       in dto ? { maxAmountByMethod:       dto.maxAmountByMethod       as object } : {}),
        ...('allowedCurrencies'       in dto ? { allowedCurrencies:       dto.allowedCurrencies! } : {}),
        ...('intentTtlMinutes'        in dto ? { intentTtlMinutes:        dto.intentTtlMinutes! } : {}),
        ...('momoPushTimeoutSeconds'  in dto ? { momoPushTimeoutSeconds:  dto.momoPushTimeoutSeconds! } : {}),
        ...('webhookRetryMaxAttempts' in dto ? { webhookRetryMaxAttempts: dto.webhookRetryMaxAttempts! } : {}),
        ...('reconciliationLagMinutes' in dto ? { reconciliationLagMinutes: dto.reconciliationLagMinutes! } : {}),
        ...('passProviderFeesToCustomer' in dto ? { passProviderFeesToCustomer: dto.passProviderFeesToCustomer! } : {}),
        ...('surchargePercentByMethod' in dto ? { surchargePercentByMethod: dto.surchargePercentByMethod as object } : {}),
        ...('requireCustomerEmailFor' in dto ? { requireCustomerEmailFor: dto.requireCustomerEmailFor! } : {}),
        ...('allowGuestCheckout'      in dto ? { allowGuestCheckout:      dto.allowGuestCheckout! } : {}),
        ...('refundMfaThreshold'      in dto ? { refundMfaThreshold:      dto.refundMfaThreshold! } : {}),
        ...('payoutMethod'            in dto ? { payoutMethod:            dto.payoutMethod! } : {}),
        ...('payoutPhoneE164'         in dto ? { payoutPhoneE164:         dto.payoutPhoneE164 } : {}),
        ...('payoutSubaccountId'      in dto ? { payoutSubaccountId:      dto.payoutSubaccountId } : {}),
        ...('payoutAccountName'       in dto ? { payoutAccountName:       dto.payoutAccountName } : {}),
      },
    });
  }
}
