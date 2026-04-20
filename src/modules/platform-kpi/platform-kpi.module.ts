import { Module } from '@nestjs/common';
import { PlatformKpiService } from './platform-kpi.service';

/**
 * PlatformKpiModule — enregistre le service KPI cross-tenant.
 *
 * Le controller est déclaré dans Sprint 3. Ce module exporte le service pour
 * permettre à d'autres modules (alertes, notifications) de consommer les KPI.
 *
 * Dépendances :
 *   - PrismaService             : @Global via PrismaModule
 *   - PlatformConfigService     : @Global via PlatformConfigModule
 */
@Module({
  providers: [PlatformKpiService],
  exports:   [PlatformKpiService],
})
export class PlatformKpiModule {}
