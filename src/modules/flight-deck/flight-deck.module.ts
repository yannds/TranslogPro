import { Module } from '@nestjs/common';
import { FlightDeckService } from './flight-deck.service';
import { FlightDeckController } from './flight-deck.controller';

@Module({
  controllers: [FlightDeckController],
  providers:   [FlightDeckService],
  exports:     [FlightDeckService],
})
export class FlightDeckModule {}
