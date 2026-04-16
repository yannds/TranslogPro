import { Module } from '@nestjs/common';
import { FleetService } from './fleet.service';
import { FleetController } from './fleet.controller';
import { FleetTrackingService } from './fleet-tracking.service';
import { FleetTrackingController } from './fleet-tracking.controller';
import { StorageModule } from '../../infrastructure/storage/storage.module';

@Module({
  imports:     [StorageModule],
  controllers: [FleetController, FleetTrackingController],
  providers:   [FleetService, FleetTrackingService],
  exports:     [FleetService, FleetTrackingService],
})
export class FleetModule {}
