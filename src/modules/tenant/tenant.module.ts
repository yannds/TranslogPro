import { Module } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { TenantModuleService } from './tenant-module.service';
import { TenantModuleController } from './tenant-module.controller';

@Module({
  controllers: [TenantController, TenantModuleController],
  providers:   [TenantService, TenantModuleService],
  exports:     [TenantService, TenantModuleService],
})
export class TenantModule {}
