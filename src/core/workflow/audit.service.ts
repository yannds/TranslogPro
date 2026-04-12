import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * Audit plane — distinguishes configuration changes from data mutations.
 * PRD §III.6 — ISO 27001 compliance.
 */
export type AuditPlane = 'control' | 'data';

/**
 * Severity level for the audit entry.
 *   info     → routine data operations
 *   warn     → sensitive operations (cancellations, overrides)
 *   critical → security-relevant events: workflow.override.global, SOS, biometric access,
 *              session revocation, DLQ replay, cross-tenant access
 */
export type AuditLevel = 'info' | 'warn' | 'critical';

export interface AuditEntry {
  tenantId:      string;
  userId?:       string;       // DB User.id (optionnel — events système n'ont pas d'acteur)
  /**
   * The permission string exercised — not a free-form label.
   * e.g. "data.ticket.scan.agency", "control.workflow.override.global"
   * This lets the audit trail be filtered by permission plane/scope.
   */
  action:        string;
  /** Composite resource identifier: "<AggregateType>:<id>" e.g. "Ticket:clx..." */
  resource:      string;
  oldValue?:     Record<string, unknown>;
  newValue?:     Record<string, unknown>;
  ipAddress?:    string;
  plane?:        AuditPlane;
  level?:        AuditLevel;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    const plane = entry.plane ?? this.inferPlane(entry.action);
    const level = entry.level ?? this.inferLevel(entry.action);

    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId:  entry.tenantId,
          userId:    entry.userId   ?? null,
          action:    entry.action,             // permission string exercée
          resource:  entry.resource,
          plane,
          level,
          oldValue:  entry.oldValue as Prisma.InputJsonValue | undefined,
          newValue:  entry.newValue as Prisma.InputJsonValue | undefined,
          ipAddress: entry.ipAddress ?? null,
        },
      });

      // Critical events are also emitted to application logs for SIEM ingestion
      if (level === 'critical') {
        this.logger.warn(
          `[AUDIT:CRITICAL] ${entry.action} on ${entry.resource} ` +
          `by actor=${entry.userId ?? 'system'} tenant=${entry.tenantId} ip=${entry.ipAddress ?? 'unknown'}`,
        );
      }
    } catch (err) {
      // Audit failures must NEVER break the business flow, but must be visible
      this.logger.error(
        `Audit write failed for action="${entry.action}" resource=${entry.resource} — ${(err as Error).message}`,
      );
    }
  }

  // ── Inference helpers ──────────────────────────────────────────────────────

  private inferPlane(action: string): AuditPlane {
    return action.startsWith('control.') ? 'control' : 'data';
  }

  private inferLevel(action: string): AuditLevel {
    if (CRITICAL_ACTIONS.some(p => action.includes(p))) return 'critical';
    if (WARN_ACTIONS.some(p => action.includes(p)))     return 'warn';
    return 'info';
  }
}

/**
 * Actions that always produce a critical audit entry regardless of context.
 * PRD §III.6 + §IV.6 — loggé niveau "critical", visible SIEM.
 */
const CRITICAL_ACTIONS: string[] = [
  'workflow.override',  // force-transition (SuperAdmin)
  'session.revoke',     // révocation de session
  'sav.deliver',        // remise physique objet trouvé (signature/biométrie)
  'sav.report.own',     // SOS chauffeur
  'iam.manage',         // création/modification rôles
  'integration.setup',  // config Vault / SCIM
  'id_photo',           // accès donnée biométrique
];

const WARN_ACTIONS: string[] = [
  'ticket.cancel',
  'parcel.report',
  'cashier.close',
  'maintenance.approve',
  'pricing.yield',
];
