import { Module } from '@nestjs/common';
import { PublicReporterController, PublicReporterHostController } from './public-reporter.controller';
import { PublicReporterService } from './public-reporter.service';

@Module({
  controllers: [PublicReporterController, PublicReporterHostController],
  providers:   [PublicReporterService],
})
export class PublicReporterModule {}
