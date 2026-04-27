import { Module } from '@nestjs/common';
import { BulkImportService } from './bulk-import.service';
import { BulkImportController } from './bulk-import.controller';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [DatabaseModule, StaffModule],
  controllers: [BulkImportController],
  providers: [BulkImportService],
})
export class BulkImportModule {}
