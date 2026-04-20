import { Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';
import { EventBusModule } from '../../infrastructure/eventbus/eventbus.module';

/**
 * Realtime module — expose l'endpoint SSE tenant-scoped (Sprint 6).
 * Dépend de REDIS_CLIENT exporté par EventBusModule.
 */
@Module({
  imports:     [EventBusModule],
  controllers: [RealtimeController],
  providers:   [RealtimeService],
})
export class RealtimeModule {}
