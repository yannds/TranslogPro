import { Module } from '@nestjs/common';
import { PlatformTelecomController } from './platform-telecom.controller';
import { PlatformTelecomService } from './platform-telecom.service';

/**
 * PlatformTelecomModule — exposition admin plateforme des providers SMS/WhatsApp.
 *
 * SECRET_SERVICE et PrismaService sont @Global, pas besoin d'imports ici.
 * Symétrique à PlatformEmailModule.
 */
@Module({
  controllers: [PlatformTelecomController],
  providers:   [PlatformTelecomService],
})
export class PlatformTelecomModule {}
