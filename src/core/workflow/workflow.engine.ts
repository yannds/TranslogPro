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
import { IWorkflowIO, PersistFn } from './io/workflow-io.interface';
import { LiveWorkflowIO } from './io/live-workflow.io';
import { SideEffectRegistry } from './side-effect.registry';

export interface WorkflowTransitionConfig<E extends WorkflowEntity> {
  /** Type d'entité — doit correspondre à WorkflowConfig.entityType en DB */
  aggregateType: string;
  /** Guards applicatifs supplémentaires */
  guards?:       GuardDefinition<E>[];
  /**
   * Side-effects SYNCHRONES CRITIQUES uniquement — exécutés dans la même transaction.
   * Les side-effects non-critiques (notifications, webhooks) doivent passer par l'Outbox
   * pour éviter de bloquer la transaction sur des appels externes.
   */
  sideEffects?:  SideEffectDefinition<E>[];
  /**
   * Callback de persistance — DOIT incrémenter `version` pour le lock optimiste.
   */
  persist: PersistFn<E>;
}

export interface WorkflowResult<E extends WorkflowEntity> {
  entity:    E;
  toState:   string;
  fromState: string;
}

@Injectable()
export class WorkflowEngine {
  private readonly logger = new Logger(WorkflowEngine.name);
  private readonly defaultIO: IWorkflowIO;

  private readonly sideEffectRegistry: SideEffectRegistry;

  constructor(
    prisma: PrismaService,
    audit:  AuditService,
    sideEffectRegistry?: SideEffectRegistry,
  ) {
    // L'engine instancie son I/O par défaut (live). Les appels en mode simulation
    // passent un `ioOverride` à transition() — aucun changement de DI requis.
    this.defaultIO = new LiveWorkflowIO(prisma, audit);
    // Registry optionnelle pour back-compat tests — un registre vide est équivalent
    // au comportement historique (zéro side-effect déclaratif résolu).
    this.sideEffectRegistry = sideEffectRegistry ?? new SideEffectRegistry();
  }

  /**
   * Exécute une transition selon l'algorithme PRD §III.3 :
   *
   * 1. CONFIG       → WorkflowConfig(tenantId, entityType, fromState, action)
   * 2. PERMISSION   → RolePermission en DB (zero hardcode)
   * 3. GUARDS       → GuardEvaluator applicatif
   * 4. TRANSACTION  → idempotence check + lock + persist + log + audit
   * 5. SIDE EFFECTS → dans la transaction (critiques uniquement)
   *
   * IDEMPOTENCE : check ET insert sont dans la même transaction atomique.
   * Race condition P2002 → capturée et convertie en replay idempotent (409 → entity).
   *
   * LOCKING : SELECT FOR UPDATE NOWAIT sur le vrai nom de table (whitelist),
   * délégué à l'IO (LiveWorkflowIO utilise Prisma.raw() anti-injection).
   * Échec → ConflictException(423) — jamais swallowed silencieusement.
   *
   * MODE SIMULATION : passer `ioOverride` (SimulationWorkflowIO) exécute la même
   * logique mais contre un I/O en mémoire — zéro écriture DB, side-effects capturés.
   */
  async transition<E extends WorkflowEntity>(
    entity: E,
    input:  TransitionInput,
    config: WorkflowTransitionConfig<E>,
    ioOverride?: IWorkflowIO,
  ): Promise<WorkflowResult<E>> {
    const io = ioOverride ?? this.defaultIO;
    const { action, actor, idempotencyKey, ipAddress } = input;

    // ── Pré-validation whitelist (fail-fast avant toute requête DB) ───────────
    // Préserve le comportement de l'ancien engine : invalider aggregateType
    // avant de toucher à Prisma. Défense en profondeur — txIO.lockEntity re-check.
    if (!io.supportsAggregateType(config.aggregateType)) {
      throw new BadRequestException(
        `aggregateType "${config.aggregateType}" non reconnu par le WorkflowEngine`,
      );
    }

    // ── 0. Idempotence rapide (hors transaction) ──────────────────────────────
    // Si la clé est déjà connue, on court-circuite AVANT la validation d'état.
    // Cas typique : retry HTTP après que l'état ait déjà changé en DB.
    // Le check atomique dans la transaction (4a) reste la barrière définitive.
    if (idempotencyKey) {
      const earlyExisting = await io.findIdempotentTransition(idempotencyKey);
      if (earlyExisting) {
        this.logger.debug(`Idempotent early-exit: key=${idempotencyKey}`);
        return { entity, toState: earlyExisting.toState, fromState: earlyExisting.fromState };
      }
    }

    // ── 1. Résolution (tenantId, entityType, fromState, action) → toState ────
    // Hors transaction : lecture seule, pas de side-effects.
    // La clé composite @@unique([tenantId, entityType, fromState, action, version])
    // garantit qu'un tenant ne peut pas injecter une config pour un autre tenant.
    const wfConfig = await io.loadConfig(
      entity.tenantId,
      config.aggregateType,
      entity.status,
      action,
    );

    if (!wfConfig) {
      throw new BadRequestException(
        `Transition interdite : ${config.aggregateType} état="${entity.status}" action="${action}" ` +
        `(aucune WorkflowConfig active pour tenant=${entity.tenantId})`,
      );
    }

    const { toState, requiredPerm, sideEffectNames } = wfConfig;

    // ── 2. Vérification de permission — DB-driven, zéro hardcode ─────────────
    // Note : le PermissionGuard a déjà vérifié la permission de la route HTTP.
    // Ce deuxième check ici est une défense en profondeur pour les transitions
    // déclenchées programmatiquement (scheduler, side-effects d'autres transitions).
    const hasPerm = await io.hasPermission(actor.roleId, requiredPerm);
    if (!hasPerm) {
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

    // ── 3. Guards applicatifs ─────────────────────────────────────────────────
    const ctx = input.context ?? {};
    for (const guard of config.guards ?? []) {
      const allowed = await guard.fn(entity, input, ctx);
      if (!allowed) {
        throw new BadRequestException(
          `Guard "${guard.name}" a bloqué la transition "${action}" → "${toState}"`,
        );
      }
    }

    // ── 4. Transaction atomique ────────────────────────────────────────────────
    return io.runInTransaction(async (txIO) => {
      const effectiveKey = idempotencyKey ?? randomUUID();

      // ── 4a. Idempotence check DANS la transaction ────────────────────────
      // Atomique avec l'insert → élimine la race condition.
      const existing = await txIO.findIdempotentTransition(effectiveKey);
      if (existing) {
        this.logger.debug(`Idempotent replay: key=${effectiveKey}`);
        return { entity, toState: existing.toState, fromState: existing.fromState };
      }

      // ── 4b. Lock pessimiste — SELECT FOR UPDATE NOWAIT ──────────────────
      // Whitelist validée dans l'IO → Prisma.raw() sans risque d'injection.
      // Ne swallow JAMAIS l'erreur : si le lock échoue, la transaction échoue.
      const lock = await txIO.lockEntity(config.aggregateType, entity.id);
      if (!lock) {
        throw new ConflictException(
          `Entité ${config.aggregateType}:${entity.id} introuvable pour lock`,
        );
      }
      if (lock.version !== entity.version) {
        throw new ConflictException(
          `Modification concurrente détectée sur ${config.aggregateType}:${entity.id} ` +
          `(version attendue=${entity.version}, trouvée=${lock.version}) — réessayez`,
        );
      }

      // ── 4c. Persistance de l'état cible ─────────────────────────────────
      const updated = await txIO.persist(entity, toState, config.persist);

      // ── 4d. Log de transition (idempotence + historique) ─────────────────
      try {
        await txIO.recordTransition({
          tenantId:       entity.tenantId,
          entityType:     config.aggregateType,
          entityId:       entity.id,
          fromState:      entity.status,
          action,
          toState,
          userId:         actor.id,
          idempotencyKey: effectiveKey,
        });
      } catch (e: any) {
        // P2002 = race condition : un autre pod a commité la même clé entre
        // le findIdempotentTransition ci-dessus et cet insert. Retourner l'entité existante.
        if (e?.code === 'P2002') {
          this.logger.warn(
            `Idempotency race P2002 capturée pour key=${effectiveKey} — replay safe`,
          );
          const committed = await txIO.findIdempotentTransition(effectiveKey);
          if (committed) {
            return { entity, toState: committed.toState, fromState: committed.fromState };
          }
        }
        throw e;
      }

      // ── 4e. Audit trail ISO 27001 ─────────────────────────────────────────
      // L'audit est dans la transaction pour garantir qu'il ne peut pas manquer.
      // AuditService.record() avale ses propres erreurs (non-breaking) —
      // mais les erreurs critiques sont quand même loguées.
      await txIO.recordAudit({
        tenantId: entity.tenantId,
        userId:   actor.id,
        action:   requiredPerm,  // permission exercée — format canonique pour SIEM
        resource: `${config.aggregateType}:${entity.id}`,
        oldValue: { status: entity.status, version: entity.version },
        newValue: { status: toState, version: entity.version + 1 },
        ipAddress,
      });

      // ── 4f. Side-effects SYNCHRONES CRITIQUES ────────────────────────────
      // Règle : aucun appel HTTP/NATS/gRPC ici. Seules les modifications DB
      // (ex: mise à jour du seat_map) sont admises dans cette transaction.
      // Les notifications, webhooks → OutboxEvent (asynchrone, non-bloquant).
      //
      // Deux sources de side-effects — toutes deux exécutées atomiquement :
      //   (a) IMPÉRATIF : `config.sideEffects` passé par le service caller
      //                   (back-compat — zéro régression pour le code existant)
      //   (b) DÉCLARATIF : noms dans WorkflowConfig.sideEffects (blueprint DB)
      //                   résolus via SideEffectRegistry. Permet à l'admin d'ajouter
      //                   des handlers via /admin/workflow-studio sans toucher au code.
      for (const se of config.sideEffects ?? []) {
        await txIO.runSideEffect(se, updated, input, ctx);
      }
      if (sideEffectNames.length > 0) {
        const declaratives = this.sideEffectRegistry.resolve(sideEffectNames);
        for (const se of declaratives) {
          await txIO.runSideEffect(se, updated, input, ctx);
        }
      }

      this.logger.log(
        `[${config.aggregateType}:${entity.id}] "${entity.status}" --[${action}]--> "${toState}" ` +
        `actor=${actor.id} perm=${requiredPerm}`,
      );

      return { entity: updated, toState, fromState: entity.status };
    });
  }
}
