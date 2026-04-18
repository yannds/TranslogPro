import { Module } from '@nestjs/common';
import {
  PlatformSupportController,
  TenantSupportController,
} from './support.controller';
import { SupportService } from './support.service';

@Module({
  controllers: [TenantSupportController, PlatformSupportController],
  providers:   [SupportService],
  exports:     [SupportService],
})
export class SupportModule {}
