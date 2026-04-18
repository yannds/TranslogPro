import { Global, Module } from '@nestjs/common';
import { PlatformConfigController } from './platform-config.controller';
import { PlatformConfigService } from './platform-config.service';

/**
 * @Global — PlatformConfigService est injecté par analytics, billing et
 * support sans import explicite dans leur Module.
 */
@Global()
@Module({
  controllers: [PlatformConfigController],
  providers:   [PlatformConfigService],
  exports:     [PlatformConfigService],
})
export class PlatformConfigModule {}
