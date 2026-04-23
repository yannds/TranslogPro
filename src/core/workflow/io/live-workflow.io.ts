/**
 * LiveWorkflowIO
 *
 * Implémentation de production : déléguation 1:1 aux services réels.
 * Reproduit EXACTEMENT les appels Prisma/Audit de l'ancien workflow.engine.ts
 * pour garantir zéro régression comportementale (même suite de tests).
 */
import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService, AuditEntry } from '../audit.service';
import { WorkflowEntity } from '../interfaces/workflow-entity.interface';
import { TransitionInput } from '../interfaces/transition-input.interface';
import { SideEffectDefinition } from '../types/side-effect-definition.type';
import {
  IWorkflowIO,
  IWorkflowTxIO,
  IdempotentTransitionSummary,
  ResolvedWorkflowConfig,
  PersistFn,
} from './workflow-io.interface';

/**
 * Whitelist des tables Postgres par aggregateType — protège contre l'injection SQL
 * dans le SELECT FOR UPDATE NOWAIT. Valeur identique à l'ancien workflow.engine.ts.
 */
const AGGREGATE_TABLE_MAP: Record<string, string> = {
  Trip:              'trips',
  Ticket:            'tickets',
  Traveler:          'travelers',
  Parcel:            'parcels',
  Shipment:          'shipments',
  Bus:               'buses',
  Claim:             'claims',
  Refund:            'refunds',
  // Ajoutés 2026-04-19 : tous les aggregateType invoqués par les services
  // (manifest.service, incident.service, etc.) doivent être whitelistés ici
  // sinon WorkflowEngine.transition() throw 400 "non reconnu" avant même
  // de toucher à WorkflowConfig.
  Manifest:          'manifests',
  Checklist:         'checklists',
  Incident:          'incidents',
  MaintenanceReport: 'maintenance_reports',
  CashRegister:      'cash_registers',
  SafetyAlert:       'safety_alerts',
  CrewAssignment:    'crew_assignments',
  PublicReport:      'public_reports',
  AccidentReport:    'accident_reports',
  // Driver utilise le table 'staff' via Staff model — pas de model Driver
  // séparé, à ajouter si un service explicite le requiert.
  // Ajoutés 2026-04-19 pour les migrations hardcoded → engine + nouveaux scénarios
  Invoice:           'invoices',
  Staff:             'staff',
  StaffAssignment:   'staff_assignments',
  SupportTicket:     'support_tickets',
  DriverTraining:    'driver_trainings',
  QhseExecution:     'qhse_procedure_executions',
  Voucher:           'vouchers',
  CompensationItem:  'compensation_items',
};

// ─── Transactional IO ─────────────────────────────────────────────────────────

export class LiveWorkflowTxIO implements IWorkflowTxIO {
  constructor(
    /** Client Prisma transactionnel (typé any car c'est l'objet tx de $transaction). */
    private readonly tx:    any,
    private readonly audit: AuditService,
  ) {}

  async findIdempotentTransition(
    idempotencyKey: string,
  ): Promise<IdempotentTransitionSummary | null> {
    const row = await this.tx.workflowTransition.findUnique({ where: { idempotencyKey } });
    if (!row) return null;
    return { toState: row.toState, fromState: row.fromState };
  }

  async lockEntity(
    aggregateType: string,
    entityId:      string,
  ): Promise<{ version: number } | null> {
    const tableName = AGGREGATE_TABLE_MAP[aggregateType];
    if (!tableName) {
      throw new BadRequestException(
        `aggregateType "${aggregateType}" non reconnu par le WorkflowEngine`,
      );
    }

    const rows = (await this.tx.$queryRaw(
      Prisma.sql`
        SELECT version
        FROM   ${Prisma.raw(`"${tableName}"`)}
        WHERE  id = ${entityId}
        FOR UPDATE NOWAIT
      `,
    )) as { version: number }[];

    const currentVersion = rows[0]?.version;
    if (currentVersion === undefined) return null;
    return { version: currentVersion };
  }

  persist<E extends WorkflowEntity>(
    entity:    E,
    toState:   string,
    persistFn: PersistFn<E>,
  ): Promise<E> {
    return persistFn(entity, toState, this.tx as unknown as PrismaService);
  }

  async recordTransition(data: {
    tenantId:       string;
    entityType:     string;
    entityId:       string;
    fromState:      string;
    action:         string;
    toState:        string;
    userId:         string;
    idempotencyKey: string;
  }): Promise<void> {
    await (this.tx as unknown as PrismaService).workflowTransition.create({ data });
  }

  async recordAudit(entry: AuditEntry): Promise<void> {
    await this.audit.record(entry);
  }

  async runSideEffect<E extends WorkflowEntity>(
    sideEffect: SideEffectDefinition<E>,
    entity:     E,
    input:      TransitionInput,
    context:    Record<string, unknown>,
  ): Promise<void> {
    await sideEffect.fn(entity, input, context);
  }
}

// ─── Root IO ──────────────────────────────────────────────────────────────────

@Injectable()
export class LiveWorkflowIO implements IWorkflowIO {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit:  AuditService,
  ) {}

  supportsAggregateType(aggregateType: string): boolean {
    return aggregateType in AGGREGATE_TABLE_MAP;
  }

  async findIdempotentTransition(
    idempotencyKey: string,
  ): Promise<IdempotentTransitionSummary | null> {
    const row = await this.prisma.workflowTransition.findUnique({ where: { idempotencyKey } });
    if (!row) return null;
    return { toState: row.toState, fromState: row.fromState };
  }

  async loadConfig(
    tenantId:   string,
    entityType: string,
    fromState:  string,
    action:     string,
  ): Promise<ResolvedWorkflowConfig | null> {
    const wfConfig = await this.prisma.workflowConfig.findFirst({
      where: { tenantId, entityType, fromState, action, isActive: true },
    });
    if (!wfConfig) return null;
    // `sideEffects: Json` stocke soit un tableau de strings (noms de handlers),
    // soit un tableau d'objets {name, params} (future extension). On tolère les
    // deux formats. Format invalide → liste vide + warn (non bloquant).
    const raw = (wfConfig as { sideEffects?: unknown }).sideEffects;
    let sideEffectNames: string[] = [];
    if (Array.isArray(raw)) {
      sideEffectNames = raw
        .map((item: unknown) =>
          typeof item === 'string' ? item :
          (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string')
            ? (item as { name: string }).name
            : null,
        )
        .filter((x): x is string => typeof x === 'string' && x.length > 0);
    }
    return {
      toState:         wfConfig.toState as string,
      requiredPerm:    wfConfig.requiredPerm as string,
      sideEffectNames,
    };
  }

  async hasPermission(roleId: string, permission: string): Promise<boolean> {
    const rp = await this.prisma.rolePermission.findFirst({
      where: { roleId, permission },
    });
    return rp !== null;
  }

  runInTransaction<T>(fn: (txIO: IWorkflowTxIO) => Promise<T>): Promise<T> {
    return this.prisma.transact(async (tx) => {
      return fn(new LiveWorkflowTxIO(tx, this.audit));
    });
  }
}
