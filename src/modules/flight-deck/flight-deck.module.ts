import { Module } from '@nestjs/common';
import { FlightDeckService } from './flight-deck.service';
import { FlightDeckController } from './flight-deck.controller';
import { TravelerModule } from '../traveler/traveler.module';
import { WorkflowModule } from '../../core/workflow/workflow.module';

@Module({
  imports:     [TravelerModule, WorkflowModule],
  controllers: [FlightDeckController],
  providers:   [FlightDeckService],
  exports:     [FlightDeckService],
})
export class FlightDeckModule {}
