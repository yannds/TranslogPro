/**
 * Endpoint public en lecture seule : commission plateforme par défaut.
 *
 * Utilisé par les pages tenant pour afficher en clair "vous recevez X%,
 * frais plateforme = Y%". Pas de permission, pas de tenantId — c'est une
 * info publique (la commission par défaut s'applique à tous, l'override
 * éventuel est lu via TenantPaymentConfig côté tenant lui-même).
 *
 * Les champs payout plateforme (numéro MoMo perso, etc.) NE SONT PAS
 * exposés ici — ils ne sortent jamais de la route super-admin.
 */
import { Controller, Get } from '@nestjs/common';
import { PublicRoute } from '../../common/decorators/public-route.decorator';
import { PlatformPaymentService } from './platform-payment.service';

@Controller({ version: '1', path: 'public/platform-fee' })
export class PlatformFeePublicController {
  constructor(private readonly service: PlatformPaymentService) {}

  @PublicRoute('Commission plateforme — info publique en lecture seule')
  @Get()
  async get() {
    const cfg = await this.service.get();
    return {
      platformFeeBps:       cfg.platformFeeBps,
      platformFeePolicy:    cfg.platformFeePolicy,
      platformFeeFlatMinor: cfg.platformFeeFlatMinor,
    };
  }
}
