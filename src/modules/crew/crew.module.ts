import { Module } from '@nestjs/common';
import { CrewController }            from './crew.controller';
import { CrewAssignmentsController } from './crew-assignments.controller';
import { CrewService }                from './crew.service';
import { SchedulingGuardModule }     from '../scheduling-guard/scheduling-guard.module';

@Module({
  imports:     [SchedulingGuardModule],
  controllers: [CrewController, CrewAssignmentsController],
  providers:   [CrewService],
  exports:     [CrewService],
})
export class CrewModule {}
