import { Module } from '@nestjs/common';
import { CrewController }        from './crew.controller';
import { CrewService }           from './crew.service';
import { SchedulingGuardModule } from '../scheduling-guard/scheduling-guard.module';

@Module({
  imports:     [SchedulingGuardModule],
  controllers: [CrewController],
  providers:   [CrewService],
  exports:     [CrewService],
})
export class CrewModule {}
