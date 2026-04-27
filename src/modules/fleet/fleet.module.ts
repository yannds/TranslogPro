import { Module } from '@nestjs/common';
import { FleetService } from './fleet.service';
import { FleetController } from './fleet.controller';
import { FleetTrackingService } from './fleet-tracking.service';
import { FleetTrackingController } from './fleet-tracking.controller';
import { LicensePlateValidator } from './license-plate-validator.service';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { WorkflowModule } from '../../core/workflow/workflow.module';

@Module({
  imports:     [StorageModule, WorkflowModule],
  controllers: [FleetController, FleetTrackingController],
  providers:   [FleetService, FleetTrackingService, LicensePlateValidator],
  exports:     [FleetService, FleetTrackingService, LicensePlateValidator],
})
export class FleetModule {}
