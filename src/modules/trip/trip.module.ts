import { Module } from '@nestjs/common';
import { TripService }            from './trip.service';
import { TripController }         from './trip.controller';
import { SchedulingGuardModule }  from '../scheduling-guard/scheduling-guard.module';

@Module({
  imports:     [SchedulingGuardModule],
  controllers: [TripController],
  providers:   [TripService],
  exports:     [TripService],
})
export class TripModule {}
