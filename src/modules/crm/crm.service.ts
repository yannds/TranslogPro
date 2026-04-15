import { Injectable, NotFoundException, BadRequestException, ConflictException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IIdentityManager, IDENTITY_SERVICE } from '../../infrastructure/identity/interfaces/identity.interface';

export interface CreateCustomerDto {
  email:        string;
  name:         string;
  agencyId?:    string;
  phone?:       string;
  preferences?: Record<string, unknown>;
}

export interface UpdateCustomerDto {
  name?:         string;
  agencyId?:     string | null;
  phone?:        string;
  preferences?:  Record<string, unknown>;
  loyaltyScore?: number;
}

export interface CreateCampaignDto {
  name:        string;
  criteria:    Record<string, unknown>; // segments voyageurs (ex: { minLoyalty: 100, agencyId: '...' })
  messageText: string;
}

export interface UpdateCampaignDto {
  name?:        string;
  criteria?:    Record<string, unknown>;
  messageText?: string;
  status?:      'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
}

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IIdentityManager,
  ) {}

  // ─── Customer Profiles ───────────────────────────────────────────────────────

  async createCustomer(tenantId: string, dto: CreateCustomerDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException(`Email ${dto.email} déjà enregistré`);

    const agencyId = dto.agencyId && dto.agencyId.trim() !== '' ? dto.agencyId : undefined;
    if (agencyId) {
      const agency = await this.prisma.agency.findFirst({ where: { id: agencyId, tenantId } });
      if (!agency) throw new BadRequestException(`Agence ${agencyId} introuvable dans ce tenant`);
    }

    const tempPwd =
      Math.random().toString(36).slice(2, 10) +
      Math.random().toString(36).slice(2, 10).toUpperCase() +
      '!';

    const user = await this.identity.createUser({
      email:    dto.email,
      password: tempPwd,
      name:     dto.name,
      tenantId,
      agencyId,
      userType: 'VOYAGEUR',
    });

    if (dto.phone || dto.preferences) {
      await this.prisma.user.update({
        where: { id: user.id },
        data:  {
          preferences: { ...(dto.preferences ?? {}), ...(dto.phone ? { phone: dto.phone } : {}) } as any,
        },
      });
    }

    return this.getCustomer(tenantId, user.id);
  }

  async updateCustomer(tenantId: string, userId: string, dto: UpdateCustomerDto) {
    const existing = await this.prisma.user.findFirst({
      where: { tenantId, id: userId, userType: 'VOYAGEUR' },
    });
    if (!existing) throw new NotFoundException('Voyageur introuvable');

    const prevPrefs = (existing.preferences as Record<string, unknown>) ?? {};
    const nextPrefs: Record<string, unknown> = {
      ...prevPrefs,
      ...(dto.preferences ?? {}),
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
    };

    await this.prisma.user.update({
      where: { id: userId },
      data:  {
        ...(dto.name         !== undefined ? { name:         dto.name }                 : {}),
        ...(dto.agencyId     !== undefined ? { agencyId:     dto.agencyId ?? null }     : {}),
        ...(dto.loyaltyScore !== undefined ? { loyaltyScore: dto.loyaltyScore }         : {}),
        preferences: nextPrefs as any,
      },
    });

    return this.getCustomer(tenantId, userId);
  }

  async archiveCustomer(tenantId: string, userId: string) {
    const existing = await this.prisma.user.findFirst({
      where: { tenantId, id: userId, userType: 'VOYAGEUR' },
    });
    if (!existing) throw new NotFoundException('Voyageur introuvable');

    const prevPrefs = (existing.preferences as Record<string, unknown>) ?? {};
    await this.prisma.user.update({
      where: { id: userId },
      data:  { preferences: { ...prevPrefs, archived: true, archivedAt: new Date().toISOString() } as any },
    });
    return { archived: true };
  }

  /**
   * Liste les profils voyageurs du tenant (userType = VOYAGEUR).
   * Enrichit avec le nombre de tickets et le score de fidélité.
   */
  async listCustomers(
    tenantId:  string,
    agencyId?: string,
    page = 1,
    limit = 50,
  ) {
    const where: Record<string, unknown> = {
      tenantId,
      userType: 'VOYAGEUR',
      ...(agencyId ? { agencyId } : {}),
    };

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true, email: true, name: true, agencyId: true,
          loyaltyScore: true, preferences: true, createdAt: true,
        },
        orderBy: { loyaltyScore: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
    ]);

    return { total, page, limit, data: users };
  }

  /**
   * Profil détaillé d'un voyageur : infos + historique tickets + plaintes.
   */
  async getCustomer(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where:  { tenantId, id: userId, userType: 'VOYAGEUR' },
      select: {
        id: true, email: true, name: true, image: true, agencyId: true,
        loyaltyScore: true, preferences: true, createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('Voyageur introuvable');

    const [tickets, feedbacks, agency] = await Promise.all([
      this.prisma.ticket.findMany({
        where:   { tenantId, passengerId: userId },
        select:  {
          id: true, status: true, pricePaid: true, createdAt: true, qrCode: true, tripId: true,
        },
        orderBy: { createdAt: 'desc' },
        take:    50,
      }),
      this.prisma.feedback.findMany({
        where:   { tenantId, userId },
        select:  { id: true, ratings: true, comment: true, createdAt: true, tripId: true },
        orderBy: { createdAt: 'desc' },
        take:    20,
      }),
      user.agencyId
        ? this.prisma.agency.findFirst({ where: { id: user.agencyId }, select: { id: true, name: true } })
        : Promise.resolve(null),
    ]);

    const tripIds = Array.from(new Set(tickets.map(t => t.tripId)));
    const trips = tripIds.length
      ? await this.prisma.trip.findMany({
          where:  { id: { in: tripIds } },
          select: { id: true, departureScheduled: true, arrivalScheduled: true, route: { select: { name: true } } },
        })
      : [];
    const tripMap = new Map(trips.map(t => [t.id, t]));
    const ticketsWithTrip = tickets.map(t => ({ ...t, trip: tripMap.get(t.tripId) ?? null }));

    const totalSpent = tickets.reduce((sum, t) => sum + (t.pricePaid ?? 0), 0);

    return {
      ...user,
      agency,
      tickets: ticketsWithTrip,
      feedbacks,
      totalSpent,
      ticketCount: ticketsWithTrip.length,
      feedbackCount: feedbacks.length,
    };
  }

  // ─── Campaigns ───────────────────────────────────────────────────────────────

  async createCampaign(tenantId: string, createdById: string, dto: CreateCampaignDto) {
    return this.prisma.campaign.create({
      data: {
        tenantId,
        name:        dto.name,
        criteria:    dto.criteria as any,
        messageText: dto.messageText,
        createdById,
        status:      'DRAFT',
      },
    });
  }

  async listCampaigns(tenantId: string, status?: string) {
    return this.prisma.campaign.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take:    100,
    });
  }

  async getCampaign(tenantId: string, id: string) {
    const c = await this.prisma.campaign.findFirst({ where: { tenantId, id } });
    if (!c) throw new NotFoundException('Campagne introuvable');
    return c;
  }

  async updateCampaign(tenantId: string, id: string, dto: UpdateCampaignDto) {
    await this.getCampaign(tenantId, id);
    return this.prisma.campaign.update({
      where: { id },
      data:  {
        ...(dto.name        !== undefined ? { name:        dto.name }        : {}),
        ...(dto.criteria    !== undefined ? { criteria:    dto.criteria as any }    : {}),
        ...(dto.messageText !== undefined ? { messageText: dto.messageText } : {}),
        ...(dto.status      !== undefined ? { status:      dto.status }      : {}),
      },
    });
  }

  async deleteCampaign(tenantId: string, id: string) {
    const c = await this.getCampaign(tenantId, id);
    if (c.status !== 'DRAFT') {
      throw new BadRequestException('Seules les campagnes DRAFT peuvent être supprimées');
    }
    await this.prisma.campaign.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Estime l'audience de la campagne selon ses critères.
   * Critères supportés : minLoyalty, agencyId, registeredSince (ISO date).
   */
  async estimateAudience(tenantId: string, id: string): Promise<{ count: number }> {
    const campaign = await this.getCampaign(tenantId, id);
    const criteria = campaign.criteria as Record<string, unknown>;

    const where: Record<string, unknown> = { tenantId, userType: 'VOYAGEUR' };
    if (criteria['minLoyalty'] != null) {
      where['loyaltyScore'] = { gte: Number(criteria['minLoyalty']) };
    }
    if (criteria['agencyId']) {
      where['agencyId'] = criteria['agencyId'];
    }
    if (criteria['registeredSince']) {
      where['createdAt'] = { gte: new Date(criteria['registeredSince'] as string) };
    }

    const count = await this.prisma.user.count({ where });
    return { count };
  }
}
