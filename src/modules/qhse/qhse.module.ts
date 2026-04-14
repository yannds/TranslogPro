import { Module } from '@nestjs/common';
import { QhseService }    from './qhse.service';
import { QhseController } from './qhse.controller';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { StorageModule }  from '../../infrastructure/storage/storage.module';
import { EventBusModule } from '../../infrastructure/eventbus/eventbus.module';

@Module({
  imports:     [DatabaseModule, StorageModule, EventBusModule],
  controllers: [QhseController],
  providers:   [QhseService],
  exports:     [QhseService],
})
export class QhseModule {}
