import { Module } from '@nestjs/common';
import { CrewBriefingService }          from './crew-briefing.service';
import { CrewBriefingController }       from './crew-briefing.controller';
import { BriefingTemplateService }      from './briefing-template.service';
import { DriverRestCalculatorService }  from './driver-rest-calculator.service';
import { TripSafetyAlertService }       from './trip-safety-alert.service';
import { DatabaseModule }               from '../../infrastructure/database/database.module';
import { EventBusModule }               from '../../infrastructure/eventbus/eventbus.module';

@Module({
  imports:     [DatabaseModule, EventBusModule],
  controllers: [CrewBriefingController],
  providers: [
    CrewBriefingService,
    BriefingTemplateService,
    DriverRestCalculatorService,
    TripSafetyAlertService,
  ],
  exports: [
    CrewBriefingService,
    BriefingTemplateService,
    DriverRestCalculatorService,
    TripSafetyAlertService,
  ],
})
export class CrewBriefingModule {}
