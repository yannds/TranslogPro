import { Module } from '@nestjs/common';
import { DisplayGateway } from './display.gateway';
import { DisplayController } from './display.controller';

@Module({
  controllers: [DisplayController],
  providers:   [DisplayGateway],
})
export class DisplayModule {}
