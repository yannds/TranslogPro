import { Module } from '@nestjs/common';
import { PortalAdminController } from './portal-admin.controller';
import { PortalAdminService }    from './portal-admin.service';

@Module({
  controllers: [PortalAdminController],
  providers:   [PortalAdminService],
})
export class PortalAdminModule {}
