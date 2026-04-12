import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  // ─── Customer Profiles ───────────────────────────────────────────────────────

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
   * Profil détaillé d'un voyageur : infos + historique tickets.
   */
  async getCustomer(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where:  { tenantId, id: userId, userType: 'VOYAGEUR' },
      select: {
        id: true, email: true, name: true, agencyId: true,
        loyaltyScore: true, preferences: true, createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('Voyageur introuvable');

    const tickets = await this.prisma.ticket.findMany({
      where:   { tenantId, passengerId: userId },
      select:  { id: true, status: true, pricePaid: true, createdAt: true, qrCode: true },
      orderBy: { createdAt: 'desc' },
      take:    20,
    });

    const totalSpent = tickets.reduce((sum, t) => sum + (t.pricePaid ?? 0), 0);

    return { ...user, tickets, totalSpent, ticketCount: tickets.length };
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
