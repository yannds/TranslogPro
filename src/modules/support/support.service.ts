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
import { PLATFORM_TENANT_ID } from '../../../prisma/seeds/iam.seed';
import {
  AddSupportMessageDto,
  CreateSupportTicketDto,
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

  constructor(private readonly prisma: PrismaService) {}

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

  async updateByPlatform(ticketId: string, dto: UpdateSupportTicketDto) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!t) throw new NotFoundException(`Ticket ${ticketId} introuvable`);

    const data: Record<string, unknown> = {};
    if (dto.status) {
      data.status = dto.status;
      if (dto.status === 'RESOLVED' && !t.resolvedAt) data.resolvedAt = new Date();
      if (dto.status === 'CLOSED')   data.closedAt   = new Date();
    }
    if (dto.priority) {
      data.priority = dto.priority;
      // Recalcul du SLA si changement de priorité et pas encore de first response
      if (!t.firstResponseAt) {
        const { slaDueAt } = await this.resolveSla(t.tenantId, dto.priority, t.createdAt);
        data.slaDueAt = slaDueAt;
      }
    }
    if (dto.assignedToPlatformUserId !== undefined) {
      data.assignedToPlatformUserId = dto.assignedToPlatformUserId;
    }
    return this.prisma.supportTicket.update({ where: { id: ticketId }, data });
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

    // Premier response externe → met à jour firstResponseAt + status.
    const update: Record<string, unknown> = {};
    if (!msg.isInternal && !ticket.firstResponseAt) update.firstResponseAt = new Date();
    if (!msg.isInternal && ticket.status === 'OPEN') update.status = 'IN_PROGRESS';
    if (!msg.isInternal && ticket.status === 'IN_PROGRESS') update.status = 'WAITING_CUSTOMER';
    if (Object.keys(update).length > 0) {
      await this.prisma.supportTicket.update({ where: { id: ticketId }, data: update });
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
    const maxOrder = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
    const capIndex = planSla.maxPriority ? maxOrder.indexOf(planSla.maxPriority) : 3;
    const reqIndex = maxOrder.indexOf(requested);
    const priority = (reqIndex <= capIndex ? requested : planSla.maxPriority) as SupportPriority;

    const minutes = planSla.firstResponseMinByPriority?.[priority]
      ?? DEFAULT_SLA_MINUTES[priority];
    const slaDueAt = new Date(from.getTime() + minutes * 60_000);
    return { priority, slaDueAt };
  }
}
