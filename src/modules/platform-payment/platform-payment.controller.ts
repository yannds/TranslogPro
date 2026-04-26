/**
 * Endpoints super-admin pour la config plateforme paiement (singleton).
 *
 * Routes :
 *   GET   /platform/payment/config              — lecture
 *   PATCH /platform/payment/config              — mise à jour partielle
 *   PATCH /platform/payment/tenants/:tenantId/fee-override — deal négocié
 *
 * Permission : PLATFORM_BILLING_MANAGE_GLOBAL (réservé SA TransLog Pro).
 */
import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Permission } from '../../common/constants/permissions';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  PlatformPaymentService,
  UpdatePlatformPaymentConfigDto,
} from './platform-payment.service';

@Controller({ version: '1', path: 'platform/payment' })
@RequirePermission(Permission.PLATFORM_BILLING_MANAGE_GLOBAL)
export class PlatformPaymentController {
  constructor(private readonly service: PlatformPaymentService) {}

  @Get('config')
  getConfig() {
    return this.service.get();
  }

  @Patch('config')
  updateConfig(@Body() dto: UpdatePlatformPaymentConfigDto) {
    return this.service.update(dto);
  }

  /** Override commission plateforme pour un tenant donné (deals enterprise). */
  @Patch('tenants/:tenantId/fee-override')
  setTenantFeeOverride(
    @Param('tenantId') tenantId: string,
    @Body()            body:     { bps: number | null },
  ) {
    return this.service.setTenantFeeOverride(tenantId, body.bps);
  }
}
