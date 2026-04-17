import { Module } from '@nestjs/common';
import { PublicPortalController } from './public-portal.controller';
import { PublicPortalService }    from './public-portal.service';
import { WhiteLabelModule }       from '../white-label/white-label.module';
import { DocumentsModule }        from '../documents/documents.module';
import { SavModule }              from '../sav/sav.module';
import { QrService }              from '../../core/security/qr/qr.service';

@Module({
  imports:     [WhiteLabelModule, DocumentsModule, SavModule],
  controllers: [PublicPortalController],
  providers:   [PublicPortalService, QrService],
})
export class PublicPortalModule {}
