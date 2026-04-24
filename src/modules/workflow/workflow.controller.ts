import {
  Controller, Post, Body, Param, Headers, Req,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { WorkflowDispatchService } from './workflow-dispatch.service';

/**
 * PRD §VI.2 — Endpoint workflow unifié.
 *
 * POST /api/tenants/{tenantId}/workflow/transition
 * Body: { entityType, entityId, action, context? }
 *
 * Le client ne connaît que le VERBE (action). Le moteur résout
 * (fromState, action) → toState depuis WorkflowConfig en DB.
 *
 * Permission requise par action : résolue dynamiquement depuis WorkflowConfig.requiredPerm.
 * La permission de base pour accéder à l'endpoint est control.workflow.config.tenant
 * UNIQUEMENT pour les overrides SuperAdmin. Pour les transitions normales,
 * la permission est vérifiée par le WorkflowEngine lui-même.
 */
@Controller('tenants/:tenantId/workflow')
export class WorkflowController {
  constructor(private readonly dispatch: WorkflowDispatchService) {}

  @Post('transition')
  async transition(
    @TenantId() tenantId: string,
    @Body('entityType') entityType: string,
    @Body('entityId')   entityId:   string,
    @Body('action')     action:     string,
    @Body('context')    context:    Record<string, unknown> | undefined,
    @CurrentUser()      actor:      CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    if (!entityType || !entityId || !action) {
      throw new BadRequestException('entityType, entityId et action sont obligatoires');
    }

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress
      ?? 'unknown';

    return this.dispatch.dispatch({
      tenantId,
      entityType,
      entityId,
      action,
      context,
      actor,
      idempotencyKey,
      ipAddress,
    });
  }
}
