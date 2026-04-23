import { Module } from '@nestjs/common';
import { TollPointController } from './toll-point.controller';
import { TollPointService } from './toll-point.service';

@Module({
  controllers: [TollPointController],
  providers:   [TollPointService],
  exports:     [TollPointService],
})
export class TollPointModule {}
