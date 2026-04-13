import { Module }              from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService }    from './documents.service';
import { RendererModule }      from '../../infrastructure/renderer/renderer.module';
import { TemplatesModule }     from '../templates/templates.module';

@Module({
  imports:     [RendererModule, TemplatesModule],
  controllers: [DocumentsController],
  providers:   [DocumentsService],
  exports:     [DocumentsService],
})
export class DocumentsModule {}
