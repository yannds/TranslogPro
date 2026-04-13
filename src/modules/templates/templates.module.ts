import { Module }               from '@nestjs/common';
import { TemplatesController }   from './templates.controller';
import { TemplatesService }      from './templates.service';
import { StorageModule }         from '../../infrastructure/storage/storage.module';

@Module({
  imports:     [StorageModule],
  controllers: [TemplatesController],
  providers:   [TemplatesService],
  exports:     [TemplatesService],
})
export class TemplatesModule {}
