import { Controller, Sse, UseGuards, MessageEvent } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { RealtimeService } from './realtime.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

/**
 * RealtimeController — endpoint SSE pour stream live des événements domaine
 * cross-rôles (ticket vendu, incident ouvert, etc.) — Sprint 6.
 *
 * Route : GET /api/tenants/:tenantId/realtime/events
 *
 * Security :
 *   - RequirePermission STATS_READ_TENANT (lecture analytics/dashboard)
 *   - TenantGuard applique isolation stricte (le tenantId du path doit
 *     matcher la session et la permission)
 *   - RealtimeService filtre l'Observable par tenantId → zéro fuite cross-tenant
 *
 * Format SSE : chaque MessageEvent contient { data: event, type: evt.type }.
 * Le front s'abonne via EventSource(`/api/tenants/${id}/realtime/events`).
 *
 * Pas de rate limit agressif ici : la connexion SSE est single-stream long-lived
 * (1 par client). Protection déjà assurée par l'auth + la permission.
 */
@Controller('tenants/:tenantId/realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Sse('events')
  @RequirePermission(Permission.STATS_READ_TENANT)
  events(@TenantId() tenantId: string): Observable<MessageEvent> {
    return this.realtime.streamForTenant(tenantId).pipe(
      map((evt): MessageEvent => ({
        id:   evt.id,
        type: evt.type,
        data: {
          type:          evt.type,
          aggregateId:   evt.aggregateId,
          aggregateType: evt.aggregateType,
          occurredAt:    evt.occurredAt,
          // Payload visible — OK car tenant isolé. Ne JAMAIS inclure tenantId
          // ici : redondant et surface d'attaque si le client fuite le flux.
        },
      })),
    );
  }
}
