/**
 * TariffController — Endpoints grille tarifaire & promotions.
 *
 * Routes :
 *   GET    /api/v1/tenants/:tid/tariffs             — liste des grilles
 *   GET    /api/v1/tenants/:tid/tariffs/:id          — détail grille
 *   POST   /api/v1/tenants/:tid/tariffs              — créer une grille
 *   PATCH  /api/v1/tenants/:tid/tariffs/:id          — modifier une grille
 *   DELETE /api/v1/tenants/:tid/tariffs/:id          — supprimer une grille
 *   GET    /api/v1/tenants/:tid/promotions           — liste des promos
 *   GET    /api/v1/tenants/:tid/promotions/:id       — détail promo
 *   POST   /api/v1/tenants/:tid/promotions           — créer une promo
 *   PATCH  /api/v1/tenants/:tid/promotions/:id       — modifier une promo
 *   DELETE /api/v1/tenants/:tid/promotions/:id       — supprimer une promo
 */
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
} from '@nestjs/common';
import { TariffService } from './tariff.service';
import { CreateTariffGridDto, UpdateTariffGridDto } from './dto/create-tariff-grid.dto';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/create-promotion.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller({ version: '1', path: 'tenants/:tenantId' })
export class TariffController {
  constructor(private readonly tariff: TariffService) {}

  // ── Grille tarifaire ──────────────────────────────────────────────────────────

  @Get('tariffs')
  @RequirePermission(Permission.TARIFF_READ_AGENCY)
  findAllGrids(
    @Param('tenantId') tenantId: string,
    @Query('routeId')  routeId?: string,
  ) {
    return this.tariff.findAllGrids(tenantId, routeId);
  }

  @Get('tariffs/:id')
  @RequirePermission(Permission.TARIFF_READ_AGENCY)
  findOneGrid(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
  ) {
    return this.tariff.findOneGrid(tenantId, id);
  }

  @Post('tariffs')
  @RequirePermission(Permission.TARIFF_MANAGE_TENANT)
  createGrid(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateTariffGridDto,
  ) {
    return this.tariff.createGrid(tenantId, dto);
  }

  @Patch('tariffs/:id')
  @RequirePermission(Permission.TARIFF_MANAGE_TENANT)
  updateGrid(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
    @Body() dto: UpdateTariffGridDto,
  ) {
    return this.tariff.updateGrid(tenantId, id, dto);
  }

  @Delete('tariffs/:id')
  @RequirePermission(Permission.TARIFF_MANAGE_TENANT)
  removeGrid(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
  ) {
    return this.tariff.removeGrid(tenantId, id);
  }

  // ── Promotions ────────────────────────────────────────────────────────────────

  @Get('promotions')
  @RequirePermission(Permission.PROMOTION_READ_AGENCY)
  findAllPromotions(@Param('tenantId') tenantId: string) {
    return this.tariff.findAllPromotions(tenantId);
  }

  @Get('promotions/:id')
  @RequirePermission(Permission.PROMOTION_READ_AGENCY)
  findOnePromotion(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
  ) {
    return this.tariff.findOnePromotion(tenantId, id);
  }

  @Post('promotions')
  @RequirePermission(Permission.PROMOTION_MANAGE_TENANT)
  createPromotion(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreatePromotionDto,
  ) {
    return this.tariff.createPromotion(tenantId, dto);
  }

  @Patch('promotions/:id')
  @RequirePermission(Permission.PROMOTION_MANAGE_TENANT)
  updatePromotion(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
    @Body() dto: UpdatePromotionDto,
  ) {
    return this.tariff.updatePromotion(tenantId, id, dto);
  }

  @Delete('promotions/:id')
  @RequirePermission(Permission.PROMOTION_MANAGE_TENANT)
  removePromotion(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
  ) {
    return this.tariff.removePromotion(tenantId, id);
  }
}
