import { Controller, Get, Post, Patch, Put, Delete, Param, Body } from '@nestjs/common';
import { FleetService } from './fleet.service';
import { CreateBusDto } from './dto/create-bus.dto';
import { UpdateBusDto } from './dto/update-bus.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
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

  /** Modifier fiche véhicule (immat, modèle, type, capacité, année, agence) */
  @Patch('buses/:id')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBusDto,
  ) {
    return this.fleetService.updateBus(tenantId, id, dto);
  }

  /** Supprimer véhicule — refusé si voyages actifs */
  @Delete('buses/:id')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.fleetService.deleteBus(tenantId, id);
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
    @Body() body: { seatLayout?: Record<string, unknown>; isFullVip?: boolean; vipSeats?: string[] },
  ) {
    return this.fleetService.setSeatLayout(tenantId, id, body);
  }

  /** Modifier statut bus — scope agency. Transition blueprint-driven. */
  @Patch('buses/:id/status')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  updateStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('status') status: string,
    @ScopeCtx() scope: ScopeContext,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.fleetService.updateStatus(tenantId, id, status, scope, actor);
  }

  @Get('buses')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  findAll(@TenantId() tenantId: string, @ScopeCtx() scope: ScopeContext) {
    return this.fleetService.findAll(tenantId, scope);
  }

  /**
   * Renvoie le registre des masques d'immatriculation par pays pour ce tenant
   * + le code pays par défaut (Tenant.country) pour amorcer le placeholder UI.
   */
  @Get('license-plate-formats')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  getLicensePlateFormats(@TenantId() tenantId: string) {
    return this.fleetService.getLicensePlateFormats(tenantId);
  }

  /**
   * Met à jour le registre complet des formats. L'admin tenant peut ajouter,
   * modifier ou retirer des entrées. Validation : code pays ISO 3166-1 alpha-2,
   * au moins un masque non vide par pays.
   */
  @Put('license-plate-formats')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  updateLicensePlateFormats(
    @TenantId() tenantId: string,
    @Body() body: { formats: Record<string, unknown> },
  ) {
    return this.fleetService.updateLicensePlateFormats(tenantId, body.formats);
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

  // ── Photos véhicule (intérieur/extérieur — affichage Portail Voyageur) ─────

  /** Étape 1 — réserver une URL d'upload présignée. */
  @Post('buses/:id/photos/upload-url')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  requestPhotoUpload(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('ext') ext: string,
  ) {
    return this.fleetService.requestPhotoUpload(tenantId, id, ext ?? 'jpg');
  }

  /** Étape 2 — confirmer l'upload (commit du fileKey). */
  @Post('buses/:id/photos')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  addPhoto(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('fileKey') fileKey: string,
  ) {
    return this.fleetService.addPhoto(tenantId, id, fileKey);
  }

  /** Lister les photos avec URLs de téléchargement présignées (24h). */
  @Get('buses/:id/photos')
  @RequirePermission(Permission.FLEET_STATUS_AGENCY)
  listPhotos(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.fleetService.getPhotosWithUrls(tenantId, id);
  }

  /** Supprimer une photo (S3 + array). */
  @Delete('buses/:id/photos')
  @RequirePermission(Permission.FLEET_MANAGE_TENANT)
  removePhoto(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('fileKey') fileKey: string,
  ) {
    return this.fleetService.removePhoto(tenantId, id, fileKey);
  }
}
