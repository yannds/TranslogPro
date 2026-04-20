import { Module } from '@nestjs/common';
import { PlatformKpiController } from './platform-kpi.controller';
import { PlatformKpiService } from './platform-kpi.service';

/**
 * PlatformKpiModule — expose le dashboard KPI SaaS cross-tenant.
 *
 * 7 endpoints REST sous /platform/kpi/* protégés par 4 permissions
 * fine-grained (business / adoption / retention / ops). Voir le controller.
 *
 * Dépendances injectées globalement :
 *   - PrismaService             : @Global via PrismaModule
 *   - PlatformConfigService     : @Global via PlatformConfigModule
 */
@Module({
  controllers: [PlatformKpiController],
  providers:   [PlatformKpiService],
  exports:     [PlatformKpiService],
})
export class PlatformKpiModule {}
