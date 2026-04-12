import { Module } from '@nestjs/common';
import { PublicReporterController } from './public-reporter.controller';
import { PublicReporterService } from './public-reporter.service';

@Module({
  controllers: [PublicReporterController],
  providers:   [PublicReporterService],
})
export class PublicReporterModule {}
