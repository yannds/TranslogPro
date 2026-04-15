import { Module }                from '@nestjs/common';
import { DocumentsController }   from './documents.controller';
import { DocumentsService }      from './documents.service';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService }    from './attachments.service';
import { RendererModule }        from '../../infrastructure/renderer/renderer.module';
import { TemplatesModule }       from '../templates/templates.module';

@Module({
  imports:     [RendererModule, TemplatesModule],
  controllers: [DocumentsController, AttachmentsController],
  providers:   [DocumentsService, AttachmentsService],
  exports:     [DocumentsService, AttachmentsService],
})
export class DocumentsModule {}
