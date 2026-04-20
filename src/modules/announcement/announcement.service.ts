/**
 * AnnouncementService — CRUD annonces gare (sonores / visuelles) +
 * publication des événements de diffusion temps réel.
 *
 * Isolation multi-tenant : tenantId en condition racine.
 *
 * Broadcast : chaque mutation publie un DomainEvent via l'EventBus
 * (outbox → Redis pub/sub → DisplayGateway → rooms Socket.io). Les
 * consumers (écrans gare, portail voyageur, app mobile) reçoivent
 * l'annonce sans polling.
 */
import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { v4 as uuidv4 } from 'uuid';

export interface CreateAutoAnnouncementInput {
  type:           string;     // BOARDING | DELAY | CANCELLATION | SECURITY | INFO | ARRIVAL | SUSPENSION
  priority:       number;
  title:          string;
  message:        string;
  stationId?:     string | null;
  tripId?:        string | null;
  startsAt?:      Date;
  endsAt?:        Date | null;
  sourceEventId:  string;      // id du DomainEvent déclencheur — idempotence
}

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  // ── Lecture ─────────────────────────────────────────────────────────────

  async findAll(tenantId: string, stationId?: string, activeOnly = false) {
    const now = new Date();
    return this.prisma.announcement.findMany({
      where: {
        tenantId,
        ...(stationId ? { OR: [{ stationId }, { stationId: null }] } : {}),
        ...(activeOnly ? {
          isActive: true,
          startsAt: { lte: now },
          OR: stationId
            ? [
                { endsAt: null, AND: [{ OR: [{ stationId }, { stationId: null }] }] },
                { endsAt: { gte: now }, AND: [{ OR: [{ stationId }, { stationId: null }] }] },
              ]
            : [{ endsAt: null }, { endsAt: { gte: now } }],
        } : {}),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        station: { select: { id: true, name: true, city: true } },
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    const ann = await this.prisma.announcement.findFirst({
      where: { id, tenantId },
      include: {
        station: { select: { id: true, name: true, city: true } },
      },
    });
    if (!ann) throw new NotFoundException(`Annonce ${id} introuvable`);
    return ann;
  }

  // ── Écriture manuelle (UI admin) ───────────────────────────────────────

  async create(tenantId: string, dto: CreateAnnouncementDto, createdById?: string) {
    const citySlug = await this.resolveCitySlug(tenantId, dto.stationId);

    return this.prisma.transact(async (tx) => {
      const ann = await tx.announcement.create({
        data: {
          tenantId,
          stationId:   dto.stationId,
          title:       dto.title,
          message:     dto.message,
          type:        dto.type ?? 'INFO',
          priority:    dto.priority ?? 0,
          isActive:    dto.isActive ?? true,
          startsAt:    dto.startsAt ? new Date(dto.startsAt) : new Date(),
          endsAt:      dto.endsAt   ? new Date(dto.endsAt)   : null,
          createdById,
          source:      'MANUAL',
        },
      });

      await this.publish(tx as any, EventTypes.ANNOUNCEMENT_CREATED, ann, citySlug);
      return ann;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateAnnouncementDto) {
    const existing = await this.findOne(tenantId, id);
    const citySlug = await this.resolveCitySlug(tenantId, existing.stationId ?? undefined);

    return this.prisma.transact(async (tx) => {
      const updated = await tx.announcement.update({
        where: { id },
        data: {
          ...dto,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
          endsAt:   dto.endsAt   ? new Date(dto.endsAt)   : undefined,
        },
      });
      await this.publish(tx as any, EventTypes.ANNOUNCEMENT_UPDATED, updated, citySlug);
      return updated;
    });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.findOne(tenantId, id);
    const citySlug = await this.resolveCitySlug(tenantId, existing.stationId ?? undefined);

    return this.prisma.transact(async (tx) => {
      await tx.announcement.delete({ where: { id } });
      await this.publish(tx as any, EventTypes.ANNOUNCEMENT_DELETED, existing, citySlug);
      return { id, deleted: true };
    });
  }

  // ── Écriture auto (listener trip lifecycle) ─────────────────────────────

  /**
   * Crée une annonce automatique déclenchée par un événement du trip lifecycle.
   * Idempotent : le couple (tenantId, sourceEventId) est unique.
   * Retourne l'annonce existante si l'événement a déjà été traité (outbox retry).
   */
  async createAuto(tenantId: string, input: CreateAutoAnnouncementInput) {
    const citySlug = await this.resolveCitySlug(tenantId, input.stationId ?? undefined);

    try {
      return await this.prisma.transact(async (tx) => {
        const ann = await tx.announcement.create({
          data: {
            tenantId,
            stationId:     input.stationId ?? null,
            tripId:        input.tripId ?? null,
            title:         input.title,
            message:       input.message,
            type:          input.type,
            priority:      input.priority,
            isActive:      true,
            startsAt:      input.startsAt ?? new Date(),
            endsAt:        input.endsAt ?? null,
            source:        'AUTO',
            sourceEventId: input.sourceEventId,
          },
        });
        await this.publish(tx as any, EventTypes.ANNOUNCEMENT_CREATED, ann, citySlug);
        return ann;
      });
    } catch (err: unknown) {
      // Unique violation (tenantId, sourceEventId) → déjà traité, idempotent
      const code = (err as { code?: string })?.code;
      if (code === 'P2002') {
        this.logger.debug(`[Announcement] auto event ${input.sourceEventId} déjà traité — skip`);
        return this.prisma.announcement.findFirst({
          where: { tenantId, sourceEventId: input.sourceEventId },
        });
      }
      throw err;
    }
  }

  // ── Internes ────────────────────────────────────────────────────────────

  private async resolveCitySlug(tenantId: string, stationId?: string | null): Promise<string | null> {
    if (!stationId) return null;
    const station = await this.prisma.station.findFirst({
      where: { id: stationId, tenantId },
      select: { city: true },
    });
    if (!station?.city) return null;
    return station.city
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async publish(
    tx:        unknown,
    eventType: string,
    ann:       { id: string; tenantId: string; stationId: string | null; tripId: string | null; type: string; priority: number; title: string; message: string; startsAt: Date; endsAt: Date | null; isActive: boolean; source: string },
    citySlug:  string | null,
  ): Promise<void> {
    const event: DomainEvent = {
      id:            uuidv4(),
      type:          eventType,
      tenantId:      ann.tenantId,
      aggregateId:   ann.id,
      aggregateType: 'Announcement',
      payload: {
        announcementId: ann.id,
        stationId:      ann.stationId,
        tripId:         ann.tripId,
        citySlug,
        type:           ann.type,
        priority:       ann.priority,
        title:          ann.title,
        message:        ann.message,
        startsAt:       ann.startsAt.toISOString(),
        endsAt:         ann.endsAt ? ann.endsAt.toISOString() : null,
        isActive:       ann.isActive,
        source:         ann.source,
      },
      occurredAt: new Date(),
    };
    await this.eventBus.publish(event, tx as any);
  }
}
