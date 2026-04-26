import { Module } from '@nestjs/common';
import { StationService } from './station.service';
import { StationController } from './station.controller';
import { GeoModule } from '../geo/geo.module';

@Module({
  imports:     [GeoModule],
  controllers: [StationController],
  providers:   [StationService],
  exports:     [StationService],
})
export class StationModule {}
