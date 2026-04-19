/**
 * SupportService — tickets tenant → plateforme.
 *
 * Règles :
 *   - Un ticket est émis par un user d'un tenant client (actor.tenantId ≠ PLATFORM).
 *     Le tenantId du ticket est l'actorTenantId, jamais un input du body.
 *   - La queue plateforme (list / assign / reply) est accessible uniquement
 *     aux agents du tenant plateforme (permission *.global).
 *   - SLA : `slaDueAt` est calculé à partir de `plan.sla.firstResponseMin`
 *     ou, si absent, d'une valeur par défaut par priorité (voir
 *     DEFAULT_SLA_MINUTES). Tout est désactivable côté plan (DB-driven).
 *   - Les tenants ne voient que leurs propres tickets. Les messages internes
 *     (isInternal=true) ne sont JAMAIS retournés aux endpoints tenant.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { PLATFORM_TENANT_ID } from '../../../prisma/seeds/iam.seed';
import { MS_PER_MINUTE } from '../../common/constants/time';

const SYSTEM_ACTOR: CurrentUserPayload = {
  id:       'SYSTEM',
  tenantId: 'SYSTEM',
  roleId:   'SYSTEM',
} as CurrentUserPayload;
import {
  AddSupportMessageDto,
  CreateSupportTicketDto,
  SUPPORT_PRIORITIES,
  SupportPriority,
  SupportStatus,
  UpdateSupportTicketDto,
} from './dto/support.dto';

// SLA par défaut en minutes pour le premier response time. Ces valeurs ne
// s'appliquent QUE si le plan n'en fournit pas via `sla.firstResponseMinByPriority`.
// Ce n'est pas un "plan caché" — c'est un filet de sécurité pour les tenants
// sans plan (ex: ancien tenant non encore migré).
const DEFAULT_SLA_MINUTES: Record<SupportPriority, number> = {
  LOW:      24 * 60 * 5,    // 5 jours
  NORMAL:   24 * 60,        // 24 h
  HIGH:     4 * 60,         // 4 h
  CRITICAL: 60,             // 1 h
};

// Les plans TRIAL/sans plan ne peuvent pas ouvrir de tickets CRITICAL.
// Comportement : on reclassifie à HIGH au lieu de rejeter — expérience UX
// moins frustrante, la priorité réelle est décidée par le support.
// Règle DB-driven : lue depuis plan.sla.maxPriority si présent.

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
  ) {}

  // ─── Côté tenant : créer / lire / répondre à ses tickets ────────────────

  async createByTenant(
    actor: { id: string; tenantId: string },
    dto:   CreateSupportTicketDto,
  ) {
    if (actor.tenantId === PLATFORM_TENANT_ID) {
      throw new ForbiddenException('Le staff plateforme ne crée pas de tickets client');
    }

    const { priority, slaDueAt } = await this.resolveSla(actor.tenantId, dto.priority ?? 'NORMAL');

    const ticket = await this.prisma.supportTicket.create({
      data: {
        tenantId:       actor.tenantId,
        reporterUserId: actor.id,
        title:          dto.title,
        description:    dto.description,
        category:       dto.category ?? 'OTHER',
        priority,
        status:         'OPEN',
        slaDueAt,
      },
    });

    // Premier message = description. Posté par l'auteur, scope TENANT.
    await this.prisma.supportMessage.create({
      data: {
        ticketId:    ticket.id,
        authorId:    actor.id,
        authorScope: 'TENANT',
        body:        dto.description,
      },
    });

    this.logger.log(`Support ticket created tenant=${actor.tenantId} ticket=${ticket.id} priority=${priority}`);
    return ticket;
  }

  async listByTenant(tenantId: string, status?: SupportStatus) {
    return this.prisma.supportTicket.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { messages: { where: { isInternal: false } } } },
      },
    });
  }

  async findByTenant(tenantId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where:   { id: ticketId },
      include: {
        messages: { where: { isInternal: false }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} introuvable`);
    if (ticket.tenantId !== tenantId) {
      throw new ForbiddenException('Ticket hors scope tenant');
    }
    return ticket;
  }

  async addMessageByTenant(
    actor: { id: string; tenantId: string },
    ticketId: string,
    dto: AddSupportMessageDto,
  ) {
    const ticket = await this.findByTenant(actor.tenantId, ticketId);
    if (['RESOLVED', 'CLOSED'].includes(ticket.status)) {
      throw new BadRequestException('Ticket fermé, veuillez en ouvrir un nouveau');
    }

    const msg = await this.prisma.supportMessage.create({
      data: {
        ticketId,
        authorId:    actor.id,
        authorScope: 'TENANT',
        body:        dto.body,
        attachments: (dto.attachments ?? []) as object,
        isInternal:  false,
      },
    });

    // Si le ticket attendait le client, il revient en IN_PROGRESS.
    if (ticket.status === 'WAITING_CUSTOMER') {
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data:  { status: 'IN_PROGRESS' },
      });
    }
    return msg;
  }

  // ─── Côté plateforme : queue + assign + reply + transitions ─────────────

  async listPlatform(filters: { status?: SupportStatus; priority?: SupportPriority; tenantId?: string; assignedToPlatformUserId?: string }) {
    // SUPER_ADMIN only (permission .global contrôle l'accès). Si aucun filtre
    // tenantId n'est fourni, on log un warn pour tracer une vue cross-tenant
    // large (anti-exfiltration accidentelle : un super-admin qui navigue la
    // liste sans filtrer doit être audité).
    if (!filters.tenantId) {
      this.logger.warn(
        `[SUPPORT] listPlatform called WITHOUT tenantId filter — cross-tenant view ` +
        `(status=${filters.status ?? 'any'} priority=${filters.priority ?? 'any'} ` +
        `assignedTo=${filters.assignedToPlatformUserId ?? 'any'})`,
      );
    }
    return this.prisma.supportTicket.findMany({
      where: {
        ...(filters.status                    ? { status: filters.status }                       : {}),
        ...(filters.priority                  ? { priority: filters.priority }                   : {}),
        ...(filters.tenantId                  ? { tenantId: filters.tenantId }                   : {}),
        ...(filters.assignedToPlatformUserId  ? { assignedToPlatformUserId: filters.assignedToPlatformUserId } : {}),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      include: {
        tenant: { select: { id: true, name: true, slug: true, country: true, planId: true } },
        _count: { select: { messages: true } },
      },
    });
  }

  async findPlatform(ticketId: string) {
    const t = await this.prisma.supportTicket.findUnique({
      where:   { id: ticketId },
      include: {
        tenant:   { select: { id: true, name: true, slug: true, country: true, planId: true, plan: { select: { name: true, slug: true, sla: true } } } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!t) throw new NotFoundException(`Ticket ${ticketId} introuvable`);
    return t;
  }

  async updateByPlatform(
    ticketId: string,
    dto: UpdateSupportTicketDto,
    actor?: CurrentUserPayload,
  ) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!t) throw new NotFoundException(`Ticket ${ticketId} introuvable`);

    // 1) Patch des champs non-status (priority, assignedTo…) — hors workflow.
    const dataNonStatus: Record<string, unknown> = {};
    if (dto.priority) {
      dataNonStatus.priority = dto.priority;
      // Recalcul du SLA si changement de priorité et pas encore de first response
      if (!t.firstResponseAt) {
        const { slaDueAt } = await this.resolveSla(t.tenantId, dto.priority, t.createdAt);
        dataNonStatus.slaDueAt = slaDueAt;
      }
    }
    if (dto.assignedToPlatformUserId !== undefined) {
      dataNonStatus.assignedToPlatformUserId = dto.assignedToPlatformUserId;
    }
    if (Object.keys(dataNonStatus).length > 0) {
      await this.prisma.supportTicket.update({ where: { id: ticketId }, data: dataNonStatus });
    }

    // 2) Transition de status via WorkflowEngine (migration 2026-04-19, blueprint-driven).
    if (dto.status && dto.status !== t.status) {
      const action = this.resolveSupportAction(t.status, dto.status);
      if (!action) {
        throw new BadRequestException(
          `Transition interdite : ${t.status} → ${dto.status}`,
        );
      }
      await this.workflow.transition(
        t as Parameters<typeof this.workflow.transition>[0],
        { action, actor: actor ?? SYSTEM_ACTOR },
        {
          aggregateType: 'SupportTicket',
          persist: async (entity, state, p) => {
            const data: Record<string, unknown> = { status: state, version: { increment: 1 } };
            if (state === 'RESOLVED' && !t.resolvedAt) data.resolvedAt = new Date();
            if (state === 'CLOSED')                    data.closedAt   = new Date();
            return p.supportTicket.update({ where: { id: entity.id }, data }) as Promise<typeof entity>;
          },
        },
      );
    }

    const updated = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!updated) throw new NotFoundException(`Ticket ${ticketId} introuvable`);
    return updated;
  }

  /** Mappe (from,target) → action blueprint SupportTicket (snake_case). null si interdit. */
  private resolveSupportAction(from: string, target: string): string | null {
    if (from === 'OPEN'              && target === 'IN_PROGRESS')      return 'start';
    if (from === 'IN_PROGRESS'       && target === 'WAITING_CUSTOMER') return 'await';
    if (from === 'WAITING_CUSTOMER'  && target === 'IN_PROGRESS')      return 'resume';
    if (from === 'IN_PROGRESS'       && target === 'RESOLVED')         return 'resolve';
    if (from === 'WAITING_CUSTOMER'  && target === 'RESOLVED')         return 'resolve';
    if (from === 'OPEN'              && target === 'RESOLVED')         return 'resolve';
    if (from === 'RESOLVED'          && target === 'CLOSED')           return 'close';
    if (from === 'RESOLVED'          && target === 'IN_PROGRESS')      return 'reopen';
    return null;
  }

  async addMessageByPlatform(
    actor: { id: string; tenantId: string },
    ticketId: string,
    dto: AddSupportMessageDto,
  ) {
    if (actor.tenantId !== PLATFORM_TENANT_ID) {
      throw new ForbiddenException('Seul le staff plateforme peut répondre via cet endpoint');
    }
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} introuvable`);

    const msg = await this.prisma.supportMessage.create({
      data: {
        ticketId,
        authorId:    actor.id,
        authorScope: 'PLATFORM',
        body:        dto.body,
        attachments: (dto.attachments ?? []) as object,
        isInternal:  dto.isInternal ?? false,
      },
    });

    // Premier response externe → stamp firstResponseAt + transition via engine.
    // La cascade OPEN→IN_PROGRESS et IN_PROGRESS→WAITING_CUSTOMER passe désormais
    // par le blueprint SupportTicket (actions `start` / `await`) — audit homogène.
    if (!msg.isInternal && !ticket.firstResponseAt) {
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data:  { firstResponseAt: new Date() },
      });
    }
    if (!msg.isInternal && (ticket.status === 'OPEN' || ticket.status === 'IN_PROGRESS')) {
      const action = ticket.status === 'OPEN' ? 'start' : 'await';
      await this.workflow.transition(
        ticket as Parameters<typeof this.workflow.transition>[0],
        { action, actor: { id: actor.id, tenantId: actor.tenantId, roleId: '' } as CurrentUserPayload },
        {
          aggregateType: 'SupportTicket',
          persist: async (entity, state, p) => {
            return p.supportTicket.update({
              where: { id: entity.id },
              data:  { status: state, version: { increment: 1 } },
            }) as Promise<typeof entity>;
          },
        },
      );
    }
    return msg;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /**
   * Résout la priorité effective et la date limite SLA. Lit depuis le plan
   * du tenant si présent, sinon retombe sur les défauts. DB-driven.
   */
  private async resolveSla(
    tenantId: string,
    requested: SupportPriority,
    from:     Date = new Date(),
  ): Promise<{ priority: SupportPriority; slaDueAt: Date | null }> {
    const tenant = await this.prisma.tenant.findUnique({
      where:   { id: tenantId },
      include: { plan: { select: { sla: true } } },
    });
    if (!tenant) return { priority: requested, slaDueAt: null };

    const planSla = (tenant.plan?.sla ?? {}) as {
      maxPriority?: SupportPriority;
      firstResponseMinByPriority?: Partial<Record<SupportPriority, number>>;
    };

    // Priorité cappée par le plan si défini.
    // SUPPORT_PRIORITIES est trié du moins au plus critique — on réutilise
    // cet ordre pour le capping par plan.
    const capIndex = planSla.maxPriority ? SUPPORT_PRIORITIES.indexOf(planSla.maxPriority) : SUPPORT_PRIORITIES.length - 1;
    const reqIndex = SUPPORT_PRIORITIES.indexOf(requested);
    const priority = (reqIndex <= capIndex ? requested : planSla.maxPriority) as SupportPriority;

    const minutes = planSla.firstResponseMinByPriority?.[priority]
      ?? DEFAULT_SLA_MINUTES[priority];
    const slaDueAt = new Date(from.getTime() + minutes * MS_PER_MINUTE);
    return { priority, slaDueAt };
  }
}
