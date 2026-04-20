import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { REDIS_CLIENT } from '../../infrastructure/eventbus/redis-publisher.service';
import type { DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';

/**
 * RealtimeService — Pont Redis Pub/Sub → Observable par tenant (Sprint 6).
 *
 * Design :
 *   - Un subscriber Redis unique, pattern `translog:*:*`, partagé par tous les
 *     clients SSE.
 *   - Le service expose `streamForTenant(tenantId)` qui renvoie un Observable
 *     filtré STRICT sur le tenantId (isolation cross-tenant garantie).
 *   - Chaque client SSE s'abonne à son Observable et reçoit uniquement les
 *     événements de SON tenant.
 *
 * Security :
 *   - Filtrage tenantId au niveau RxJS (pas de fuite possible par channel)
 *   - Le controller vérifie permission + récupère tenantId depuis @CurrentUser
 *   - Pas de channel brut exposé côté client
 *
 * Perf :
 *   - 1 seule connexion Redis subscriber (pas une par client SSE)
 *   - Multicast via Subject — un émetteur, N abonnés
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger   = new Logger(RealtimeService.name);
  private readonly source$  = new Subject<DomainEvent>();
  private subscriber?:        Redis;
  private initializing?:      Promise<void>;

  constructor(@Inject(REDIS_CLIENT) private readonly publisherClient: Redis) {}

  /**
   * Lazy init subscriber (on duplique le client publisher Redis — même
   * config, connexion dédiée pour le mode subscribe bloquant).
   */
  private async ensureSubscriber(): Promise<void> {
    if (this.subscriber) return;
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      const sub = this.publisherClient.duplicate();
      await sub.connect().catch(() => { /* already connected */ });
      // Pattern : `translog:{tenantId}:{eventType}`
      await sub.psubscribe('translog:*:*');
      sub.on('pmessage', (_pattern, _channel, raw) => {
        try {
          const evt = JSON.parse(raw) as DomainEvent;
          this.source$.next(evt);
        } catch (e) {
          this.logger.warn(`[Realtime] Bad event on ${_channel}: ${(e as Error).message}`);
        }
      });
      this.subscriber = sub;
      this.logger.log('[Realtime] Subscribed to translog:*:* pattern');
    })();
    return this.initializing;
  }

  /**
   * Observable tenant-scoped. Utilisé par le controller SSE.
   * Garantit que seuls les événements du tenant demandé sont émis.
   */
  streamForTenant(tenantId: string): Observable<DomainEvent> {
    void this.ensureSubscriber(); // fire-and-forget init
    return this.source$.asObservable().pipe(
      filter((evt) => evt.tenantId === tenantId),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit();
    this.source$.complete();
  }
}
