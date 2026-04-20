import { Module } from '@nestjs/common';
import { DriverProfileService }    from './driver-profile.service';
import { DriverProfileController } from './driver-profile.controller';
import { DriverScoringService }    from './driver-scoring.service';
import { DatabaseModule }          from '../../infrastructure/database/database.module';
import { StorageModule }           from '../../infrastructure/storage/storage.module';
import { EventBusModule }          from '../../infrastructure/eventbus/eventbus.module';

@Module({
  imports:     [DatabaseModule, StorageModule, EventBusModule],
  controllers: [DriverProfileController],
  providers:   [DriverProfileService, DriverScoringService],
  exports:     [DriverProfileService, DriverScoringService],
})
export class DriverProfileModule {}
