import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { FleetService } from './fleet.service';
import { CreateBusDto } from './dto/create-bus.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/fleet')
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  /** Créer profil bus — Planificateur / Tenant Admin */
  @Post('buses')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  create(@TenantId() tenantId: string, @Body() dto: CreateBusDto) {
    return this.fleetService.createBus(tenantId, dto);
  }

  /**
   * Mapper plan de salle — prérequis avant toute vente numérotée.
   * PRD §IV.3 : Bus.seatLayout (JSONB) obligatoire avant vente.
   */
  @Patch('buses/:id/seat-layout')
  @RequirePermission(Permission.FLEET_LAYOUT_TENANT)
  setSeatLayout(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('seatLayout') seatLayout: Record<string, unknown>,
  ) {
    return this.fleetService.setSeatLayout(tenantId, id, seatLayout);
  }

  /** Modifier statut bus — scope agency (un agent ne touche que son agence) */
  @Patch('buses/:id/status')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  updateStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('status') status: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.fleetService.updateStatus(tenantId, id, status, scope);
  }

  @Get('buses')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  findAll(@TenantId() tenantId: string, @ScopeCtx() scope: ScopeContext) {
    return this.fleetService.findAll(tenantId, scope);
  }

  @Get('buses/:id')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.fleetService.findOne(tenantId, id);
  }

  /** Public — display screen de bus, pas d'auth requise */
  @Get('buses/:id/display')
  getDisplay(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.fleetService.getDisplayInfo(tenantId, id);
  }
}
