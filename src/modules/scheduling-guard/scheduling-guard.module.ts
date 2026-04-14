import { Module } from '@nestjs/common';
import { SchedulingGuardService } from './scheduling-guard.service';
import { DatabaseModule }         from '../../infrastructure/database/database.module';

@Module({
  imports:   [DatabaseModule],
  providers: [SchedulingGuardService],
  exports:   [SchedulingGuardService],
})
export class SchedulingGuardModule {}
