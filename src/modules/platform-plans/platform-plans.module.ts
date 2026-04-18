import { Module } from '@nestjs/common';
import { PlatformPlansController } from './platform-plans.controller';
import { PlatformPlansService } from './platform-plans.service';

@Module({
  controllers: [PlatformPlansController],
  providers:   [PlatformPlansService],
  exports:     [PlatformPlansService],
})
export class PlatformPlansModule {}
