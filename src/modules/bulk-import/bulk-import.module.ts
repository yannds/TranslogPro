import { Module } from '@nestjs/common';
import { BulkImportService } from './bulk-import.service';
import { BulkImportController } from './bulk-import.controller';
import { DatabaseModule } from '../../infrastructure/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [BulkImportController],
  providers: [BulkImportService],
})
export class BulkImportModule {}
