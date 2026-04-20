import { Module } from '@nestjs/common';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';
import { AnnouncementTripListener } from './announcement-trip.listener';

@Module({
  controllers: [AnnouncementController],
  providers:   [AnnouncementService, AnnouncementTripListener],
  exports:     [AnnouncementService],
})
export class AnnouncementModule {}
