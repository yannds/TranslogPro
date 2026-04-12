import { Module } from '@nestjs/common';
import { GarageService } from './garage.service';
import { GarageController } from './garage.controller';

@Module({
  controllers: [GarageController],
  providers:   [GarageService],
  exports:     [GarageService],
})
export class GarageModule {}
