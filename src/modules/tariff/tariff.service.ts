/**
 * TariffService — CRUD grille tarifaire + promotions.
 *
 * Isolation multi-tenant : tenantId en condition racine sur toutes les requêtes.
 */
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CreateTariffGridDto, UpdateTariffGridDto } from './dto/create-tariff-grid.dto';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/create-promotion.dto';

@Injectable()
export class TariffService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Grille tarifaire ──────────────────────────────────────────────────────────

  async findAllGrids(tenantId: string, routeId?: string) {
    return this.prisma.tariffGrid.findMany({
      where: { tenantId, ...(routeId ? { routeId } : {}) },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        route: { select: { id: true, name: true, originId: true, destinationId: true } },
      },
    });
  }

  async findOneGrid(tenantId: string, id: string) {
    const grid = await this.prisma.tariffGrid.findFirst({
      where: { id, tenantId },
      include: {
        route: { select: { id: true, name: true } },
      },
    });
    if (!grid) throw new NotFoundException(`TariffGrid ${id} introuvable`);
    return grid;
  }

  async createGrid(tenantId: string, dto: CreateTariffGridDto) {
    return this.prisma.tariffGrid.create({
      data: {
        tenantId,
        routeId:    dto.routeId,
        name:       dto.name,
        busType:    dto.busType,
        multiplier: dto.multiplier ?? 1.0,
        fixedPrice: dto.fixedPrice,
        startHour:  dto.startHour,
        endHour:    dto.endHour,
        dayMask:    dto.dayMask ?? 127,
        validFrom:  dto.validFrom ? new Date(dto.validFrom) : undefined,
        validTo:    dto.validTo   ? new Date(dto.validTo)   : undefined,
        isActive:   dto.isActive ?? true,
        priority:   dto.priority ?? 0,
      },
    });
  }

  async updateGrid(tenantId: string, id: string, dto: UpdateTariffGridDto) {
    await this.findOneGrid(tenantId, id);
    const res = await this.prisma.tariffGrid.updateMany({
      where: { id, tenantId },
      data: {
        ...dto,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validTo:   dto.validTo   ? new Date(dto.validTo)   : undefined,
      },
    });
    if (res.count === 0) throw new NotFoundException(`Grille tarifaire ${id} introuvable`);
    return this.findOneGrid(tenantId, id);
  }

  async removeGrid(tenantId: string, id: string) {
    await this.findOneGrid(tenantId, id);
    const res = await this.prisma.tariffGrid.deleteMany({ where: { id, tenantId } });
    if (res.count === 0) throw new NotFoundException(`Grille tarifaire ${id} introuvable`);
    return { id, deleted: true };
  }

  // ── Promotions ────────────────────────────────────────────────────────────────

  async findAllPromotions(tenantId: string) {
    return this.prisma.promotion.findMany({
      where: { tenantId },
      orderBy: [{ isActive: 'desc' }, { validFrom: 'desc' }],
    });
  }

  async findOnePromotion(tenantId: string, id: string) {
    const promo = await this.prisma.promotion.findFirst({ where: { id, tenantId } });
    if (!promo) throw new NotFoundException(`Promotion ${id} introuvable`);
    return promo;
  }

  async createPromotion(tenantId: string, dto: CreatePromotionDto) {
    const existing = await this.prisma.promotion.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Le code promo "${dto.code}" existe déjà`);

    return this.prisma.promotion.create({
      data: {
        tenantId,
        code:          dto.code,
        name:          dto.name,
        description:   dto.description,
        discountType:  dto.discountType,
        discountValue: dto.discountValue,
        maxUses:       dto.maxUses,
        maxPerUser:    dto.maxPerUser ?? 1,
        minAmount:     dto.minAmount,
        routeId:       dto.routeId,
        busType:       dto.busType,
        validFrom:     new Date(dto.validFrom),
        validTo:       new Date(dto.validTo),
        isActive:      dto.isActive ?? true,
      },
    });
  }

  async updatePromotion(tenantId: string, id: string, dto: UpdatePromotionDto) {
    await this.findOnePromotion(tenantId, id);
    const res = await this.prisma.promotion.updateMany({
      where: { id, tenantId },
      data: {
        ...dto,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validTo:   dto.validTo   ? new Date(dto.validTo)   : undefined,
      },
    });
    if (res.count === 0) throw new NotFoundException(`Promotion ${id} introuvable`);
    return this.findOnePromotion(tenantId, id);
  }

  async removePromotion(tenantId: string, id: string) {
    await this.findOnePromotion(tenantId, id);
    const res = await this.prisma.promotion.deleteMany({ where: { id, tenantId } });
    if (res.count === 0) throw new NotFoundException(`Promotion ${id} introuvable`);
    return { id, deleted: true };
  }
}
