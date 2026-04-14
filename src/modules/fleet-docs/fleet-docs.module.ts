import { Module } from '@nestjs/common';
import { FleetDocsService }    from './fleet-docs.service';
import { FleetDocsController } from './fleet-docs.controller';
import { DatabaseModule }      from '../../infrastructure/database/database.module';
import { StorageModule }       from '../../infrastructure/storage/storage.module';
import { EventBusModule }      from '../../infrastructure/eventbus/eventbus.module';

@Module({
  imports:     [DatabaseModule, StorageModule, EventBusModule],
  controllers: [FleetDocsController],
  providers:   [FleetDocsService],
  exports:     [FleetDocsService],
})
export class FleetDocsModule {}
