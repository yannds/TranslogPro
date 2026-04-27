import { Module }             from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService }    from './platform.service';
import { BootstrapGuard }     from './guards/bootstrap.guard';
import { StaffModule }        from '../staff/staff.module';

@Module({
  imports:     [StaffModule],
  controllers: [PlatformController],
  providers:   [PlatformService, BootstrapGuard],
  exports:     [PlatformService],
})
export class PlatformModule {}
