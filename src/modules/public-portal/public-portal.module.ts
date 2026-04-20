import { Module } from '@nestjs/common';
import { PublicPortalController } from './public-portal.controller';
import { PublicPortalService }    from './public-portal.service';
import { WhiteLabelModule }       from '../white-label/white-label.module';
import { DocumentsModule }        from '../documents/documents.module';
import { SavModule }              from '../sav/sav.module';
import { NotificationModule }     from '../notification/notification.module';
import { CrmModule }              from '../crm/crm.module';
import { AnnouncementModule }     from '../announcement/announcement.module';
import { QrService }              from '../../core/security/qr/qr.service';

@Module({
  imports:     [WhiteLabelModule, DocumentsModule, SavModule, NotificationModule, CrmModule, AnnouncementModule],
  controllers: [PublicPortalController],
  providers:   [PublicPortalService, QrService],
})
export class PublicPortalModule {}
