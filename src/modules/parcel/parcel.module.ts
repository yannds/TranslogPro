import { Module } from '@nestjs/common';
import { ParcelService } from './parcel.service';
import { ParcelController } from './parcel.controller';
import { ParcelTripListener } from './parcel-trip.listener';

@Module({
  controllers: [ParcelController],
  providers:   [ParcelService, ParcelTripListener],
  exports:     [ParcelService],
})
export class ParcelModule {}
