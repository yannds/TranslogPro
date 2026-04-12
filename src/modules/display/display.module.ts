import { Module } from '@nestjs/common';
import { DisplayController } from './display.controller';
import { DisplayGateway } from './display.gateway';
import { DisplayService } from './display.service';

/**
 * DisplayModule
 *
 * TenantConfigService est injecté automatiquement depuis GeoSafetyModule (@Global)
 * — pas besoin de l'importer explicitement ici.
 */
@Module({
  controllers: [DisplayController],
  providers:   [DisplayGateway, DisplayService],
})
export class DisplayModule {}
