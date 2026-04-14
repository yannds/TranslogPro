import { Module } from '@nestjs/common';
import { CrewBriefingService }    from './crew-briefing.service';
import { CrewBriefingController } from './crew-briefing.controller';
import { DatabaseModule }         from '../../infrastructure/database/database.module';
import { EventBusModule }         from '../../infrastructure/eventbus/eventbus.module';

@Module({
  imports:     [DatabaseModule, EventBusModule],
  controllers: [CrewBriefingController],
  providers:   [CrewBriefingService],
  exports:     [CrewBriefingService],
})
export class CrewBriefingModule {}
