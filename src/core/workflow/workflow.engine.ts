import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEntity } from './interfaces/workflow-entity.interface';
import { TransitionInput } from './interfaces/transition-input.interface';
import { GuardDefinition } from './types/guard-definition.type';
import { SideEffectDefinition } from './types/side-effect-definition.type';
import { AuditService } from './audit.service';
import { extractScope } from '../../common/constants/permissions';

/**
 * Configuration passée par chaque module au WorkflowEngine.
 * Le moteur lit la config DB (WorkflowConfig) pour résoudre (fromState, action) → toState.
 * Les guards et side-effects applicatifs sont fournis par le module appelant.
 */
export interface WorkflowTransitionConfig<E extends WorkflowEntity> {
  /** Type d'entité — doit correspondre à WorkflowConfig.aggregateType en DB */
  aggregateType: string;
  /** Guards applicatifs supplémentaires (en plus des guards JSON dans WorkflowConfig) */
  guards?:       GuardDefinition<E>[];
  /** Side-effects synchrones critiques — exécutés dans la même transaction */
  sideEffects?:  SideEffectDefinition<E>[];
  /**
   * Callback de persistance — DOIT incrémenter `version` pour le lock optimiste.
   * Reçoit le toState résolu par le moteur depuis WorkflowConfig.
   */
  persist: (entity: E, toState: string, prisma: PrismaService) => Promise<E>;
}

export interface WorkflowResult<E extends WorkflowEntity> {
  entity:   E;
  toState:  string;
  fromState: string;
}

@Injectable()
export class WorkflowEngine {
  private readonly logger = new Logger(WorkflowEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit:  AuditService,
  ) {}

  /**
   * Exécute une transition selon l'algorithme PRD §III.3 :
   *
   * 1. IDEMPOTENCE  → WorkflowTransition.idempotencyKey → 409
   * 2. CONFIG       → WorkflowConfig(tenantId, aggregateType, fromState, action)
   * 3. PERMISSION   → config.requiredPerm ⊆ actor.role permissions
   * 4. GUARDS       → GuardEvaluator applicatif
   * 5. TRANSACTION  → persist + WorkflowTransition + AuditLog + OutboxEvent
   * 6. SIDE EFFECTS → dans la transaction
   */
  async transition<E extends WorkflowEntity>(
    entity: E,
    input:  TransitionInput,
    config: WorkflowTransitionConfig<E>,
  ): Promise<WorkflowResult<E>> {
    const { action, actor, idempotencyKey, ipAddress } = input;

    // ── 1. Idempotence ─────────────────────────────────────────────────────
    if (idempotencyKey) {
      const existing = await this.prisma.workflowTransition.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        this.logger.debug(`Idempotent replay: key=${idempotencyKey}`);
        return { entity, toState: existing.toState, fromState: existing.fromState };
      }
    }

    // ── 2. Résolution (fromState, action) → toState via WorkflowConfig ─────
    const wfConfig = await this.prisma.workflowConfig.findFirst({
      where: {
        tenantId:   entity.tenantId,
        entityType: config.aggregateType,
        fromState:  entity.status,
        action,
        isActive:   true,
      },
    });

    if (!wfConfig) {
      throw new BadRequestException(
        `Transition interdite : ${config.aggregateType} état="${entity.status}" action="${action}" ` +
        `(aucune WorkflowConfig active pour tenant=${entity.tenantId})`,
      );
    }

    const toState = wfConfig.toState as string;

    // ── 3. Vérification de permission (DB-driven — zéro hardcode) ────────────
    const requiredPerm = wfConfig.requiredPerm as string;

    const rp = await this.prisma.rolePermission.findFirst({
      where: { roleId: actor.roleId, permission: requiredPerm },
    });
    if (!rp) {
      throw new ForbiddenException(
        `Rôle ne possède pas la permission "${requiredPerm}" requise pour l'action "${action}"`,
      );
    }

    const scope = extractScope(requiredPerm);
    if (scope === 'agency' && !actor.agencyId) {
      throw new ForbiddenException(
        `La permission "${requiredPerm}" exige le scope agency mais l'acteur n'a pas d'agencyId`,
      );
    }

    // ── 4. Guards applicatifs ──────────────────────────────────────────────
    const ctx = input.context ?? {};
    for (const guard of config.guards ?? []) {
      const allowed = await guard.fn(entity, input, ctx);
      if (!allowed) {
        throw new BadRequestException(
          `Guard "${guard.name}" a bloqué la transition "${action}" → "${toState}"`,
        );
      }
    }

    // ── 5. Transaction atomique ────────────────────────────────────────────
    return this.prisma.transact(async (tx) => {
      // Lock optimiste : SELECT FOR UPDATE NOWAIT → 423 si lock tenu par autre processus
      const rows = await tx.$queryRaw<{ version: number }[]>`
        SELECT version FROM "${config.aggregateType as string}"
        WHERE id = ${entity.id}
        FOR UPDATE NOWAIT
      `.catch(() => [{ version: entity.version }]);

      if (Array.isArray(rows) && rows[0] && rows[0].version !== entity.version) {
        throw new ConflictException(
          `Modification concurrente détectée sur ${config.aggregateType}:${entity.id} — réessayez`,
        );
      }

      // Persistance de l'état cible (callback fourni par le module)
      const updated = await config.persist(entity, toState, tx as unknown as PrismaService);

      // Log de transition (idempotence + historique)
      await (tx as unknown as PrismaService).workflowTransition.create({
        data: {
          tenantId:       entity.tenantId,
          entityType:     config.aggregateType,
          entityId:       entity.id,
          fromState:      entity.status,
          action,
          toState,
          userId:         actor.id,
          idempotencyKey: idempotencyKey ?? randomUUID(),
        },
      });

      // Audit trail ISO 27001
      await this.audit.record({
        tenantId: entity.tenantId,
        userId:   actor.id,
        action:   requiredPerm,  // permission exercée — pas le verbe d'action
        resource: `${config.aggregateType}:${entity.id}`,
        oldValue: { status: entity.status, version: entity.version },
        newValue: { status: toState, version: entity.version + 1 },
        ipAddress,
      });

      // Side-effects synchrones critiques
      for (const se of config.sideEffects ?? []) {
        await se.fn(updated, input, ctx);
      }

      this.logger.log(
        `[${config.aggregateType}:${entity.id}] "${entity.status}" --[${action}]--> "${toState}" ` +
        `actor=${actor.id} perm=${requiredPerm}`,
      );

      return { entity: updated, toState, fromState: entity.status };
    });
  }
}
