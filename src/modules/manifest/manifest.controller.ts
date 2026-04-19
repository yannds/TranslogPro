import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { ManifestService } from './manifest.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import type { ManifestKind } from './manifest.types';

/**
 * Routes manifestes — alignées sur le blueprint `manifest-standard`.
 *
 * POST /trips/:tripId                 → generate (DRAFT + submit → SUBMITTED)
 * PATCH/POST /:id/sign                → sign (SUBMITTED → SIGNED + PDF figé)
 * POST /:id/reject                    → reject (SUBMITTED → REJECTED)
 * POST /:id/archive                   → archive (SIGNED → ARCHIVED)
 * GET  /:id/download                  → URL signée du PDF figé
 * GET  /trips/:tripId                 → liste des manifestes du trajet
 * POST /backfill-signed-pdfs          → régénère les PDF manquants (admin)
 */
@Controller('tenants/:tenantId/manifests')
export class ManifestController {
  constructor(private readonly manifestService: ManifestService) {}

  @Post('trips/:tripId')
  @RequirePermission(Permission.MANIFEST_GENERATE_AGENCY)
  generate(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Body('kind')   kind?: ManifestKind,
  ) {
    return this.manifestService.generate(tenantId, tripId, actor, kind);
  }

  @Patch(':id/sign')
  @RequirePermission(Permission.MANIFEST_SIGN_AGENCY)
  sign(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Body('signatureSvg') signatureSvg?: string,
  ) {
    return this.manifestService.sign(tenantId, id, actor, signatureSvg);
  }

  /** Alias POST — utilisé par le mobile (compat outbox idempotency-key). */
  @Post(':id/sign')
  @RequirePermission(Permission.MANIFEST_SIGN_AGENCY)
  signPost(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Body('signatureSvg') signatureSvg?: string,
  ) {
    return this.manifestService.sign(tenantId, id, actor, signatureSvg);
  }

  @Post(':id/reject')
  @RequirePermission(Permission.MANIFEST_SIGN_AGENCY)
  reject(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.manifestService.reject(tenantId, id, actor);
  }

  @Post(':id/archive')
  @RequirePermission(Permission.MANIFEST_PRINT_AGENCY)
  archive(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.manifestService.archive(tenantId, id, actor);
  }

  // Lecture — accepte .agency (agent de quai, dispatcher, managers) ou .own
  // (chauffeur sur son propre trajet). Le scope est dérivé par le PermissionGuard
  // selon la perm détenue effectivement ; assertTripOwnership n'applique la
  // restriction own-trip qu'en scope 'own'.
  @Get(':id/download')
  @RequirePermission([Permission.MANIFEST_READ_AGENCY, Permission.MANIFEST_READ_OWN])
  download(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.manifestService.getDownloadUrl(tenantId, id, scope);
  }

  @Get('trips/:tripId')
  @RequirePermission([Permission.MANIFEST_READ_AGENCY, Permission.MANIFEST_READ_OWN])
  findByTrip(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.manifestService.findByTrip(tenantId, tripId, scope);
  }

  @Get(':id')
  @RequirePermission([Permission.MANIFEST_READ_AGENCY, Permission.MANIFEST_READ_OWN])
  findOne(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.manifestService.findOne(tenantId, id, scope);
  }

  /**
   * Backfill — régénère les PDF signés manquants (Manifest en statut SIGNED
   * sans signedPdfStorageKey). Idempotent. Permission admin agence/tenant.
   */
  @Post('backfill-signed-pdfs')
  @RequirePermission(Permission.MANIFEST_GENERATE_AGENCY)
  backfillSignedPdfs(
    @TenantId() tenantId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.manifestService.backfillSignedPdfs(tenantId, actor);
  }
}
