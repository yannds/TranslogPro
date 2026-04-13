import { Module }             from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService }    from './platform.service';
import { BootstrapGuard }     from './guards/bootstrap.guard';

@Module({
  controllers: [PlatformController],
  providers:   [PlatformService, BootstrapGuard],
  exports:     [PlatformService],
})
export class PlatformModule {}
