import { Controller, Get } from '@nestjs/common';
import { QuotaService } from './quota.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

/**
 * Quota API — observation des quotas runtime tenant (Module N PRD).
 *
 * Source de vérité runtime : Redis sliding window via `QuotaService`.
 *
 * Permission gating :
 *   - Lecture : `data.platform.read.tenant` (admin tenant)
 */
@Controller({ version: '1', path: 'tenants/:tenantId/quotas' })
export class QuotaController {
  constructor(private readonly quota: QuotaService) {}

  /**
   * Retourne l'usage instantané (consommation Redis sliding window) pour
   * chaque quota configuré côté tenant.
   */
  @Get('usage')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  async usage(@TenantId() tenantId: string) {
    return this.quota.getUsage(tenantId);
  }
}
