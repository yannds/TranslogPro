import { Module } from '@nestjs/common';
import { ManifestService } from './manifest.service';
import { ManifestController } from './manifest.controller';
import { WorkflowModule } from '../../core/workflow/workflow.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  // DocumentsModule → injection de DocumentsService pour génération automatique
  // du PDF signé au moment de la signature (cf. ManifestService.sign).
  imports:     [WorkflowModule, DocumentsModule],
  controllers: [ManifestController],
  providers:   [ManifestService],
  exports:     [ManifestService],
})
export class ManifestModule {}
