import { Module } from '@nestjs/common';
import { ParcelService } from './parcel.service';
import { ParcelController } from './parcel.controller';
import { ParcelTripListener } from './parcel-trip.listener';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports:     [CrmModule],
  controllers: [ParcelController],
  providers:   [ParcelService, ParcelTripListener],
  exports:     [ParcelService],
})
export class ParcelModule {}
