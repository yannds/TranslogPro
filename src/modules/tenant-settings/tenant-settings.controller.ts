import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/constants/permissions';
import { RedisRateLimitGuard, RateLimit } from '../../common/guards/redis-rate-limit.guard';
import { TenantTaxService, CreateTenantTaxDto, UpdateTenantTaxDto } from './tenant-tax.service';
import { TenantFareClassService, CreateTenantFareClassDto, UpdateTenantFareClassDto } from './tenant-fare-class.service';
import { TenantPaymentConfigService, UpdatePaymentConfigDto } from './tenant-payment-config.service';
import { IntegrationsService, UpdateIntegrationModeDto, SaveCredentialsDto } from './integrations.service';
import { TenantResetService } from './tenant-reset.service';

/**
 * Regroupe 3 endpoints /settings côté tenant :
 *   - /tenants/:tenantId/settings/taxes       (CRUD TenantTax)
 *   - /tenants/:tenantId/settings/payment     (GET/PATCH TenantPaymentConfig)
 *   - /tenants/:tenantId/settings/integrations (GET + PATCH mode + POST healthcheck)
 *
 * Permissions :
 *   - taxes  : TAX_READ_TENANT (GET) / TAX_MANAGE_TENANT (POST/PATCH/DELETE)
 *              — lecture séparée pour caissier/comptable, écriture pour admin/comptable/gérant.
 *   - payment: SETTINGS_MANAGE_TENANT (GET/PATCH).
 *   - integrations : INTEGRATION_SETUP_TENANT.
 *
 * Les secrets ne transitent JAMAIS par ces endpoints — uniquement via Vault.
 */
@Controller({ version: '1', path: 'tenants/:tenantId/settings' })
export class TenantSettingsController {
  constructor(
    private readonly taxes:         TenantTaxService,
    private readonly fareClasses:   TenantFareClassService,
    private readonly paymentConfig: TenantPaymentConfigService,
    private readonly integrations:  IntegrationsService,
    private readonly reset_:        TenantResetService,
  ) {}

  // ── Reset tenant (destructif — TENANT_ADMIN + re-auth + confirmation) ──
  // Garde-fous : permission granulaire + re-auth password + confirmation slug
  // + rate-limit 3/h/user. Détails dans TenantResetService.reset().
  @Post('reset')
  @RequirePermission(Permission.TENANT_RESET_TENANT)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 3, windowMs: 3_600_000, keyBy: 'userId', suffix: 'tenant_reset',
    message: 'Trop de tentatives de reset — réessayez dans 1h.',
  })
  resetTenant(
    @Param('tenantId') tenantId: string,
    @Body()            dto:      { password: string; confirmSlug: string },
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.reset_.reset(tenantId, actor.id, dto);
  }

  // ── Taxes ──────────────────────────────────────────────────────────────────
  @Get('taxes')
  @RequirePermission(Permission.TAX_READ_TENANT)
  listTaxes(@Param('tenantId') tenantId: string) {
    return this.taxes.list(tenantId);
  }

  @Post('taxes')
  @RequirePermission(Permission.TAX_MANAGE_TENANT)
  createTax(@Param('tenantId') tenantId: string, @Body() dto: CreateTenantTaxDto) {
    return this.taxes.create(tenantId, dto);
  }

  @Patch('taxes/:id')
  @RequirePermission(Permission.TAX_MANAGE_TENANT)
  updateTax(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTenantTaxDto,
  ) {
    return this.taxes.update(tenantId, id, dto);
  }

  @Delete('taxes/:id')
  @RequirePermission(Permission.TAX_MANAGE_TENANT)
  removeTax(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.taxes.remove(tenantId, id);
  }

  // ── Classes de voyage (TenantFareClass) ───────────────────────────────────
  // Read : caissier/agent doit lister les classes à la vente (dropdown).
  // Manage : réservé à TENANT_ADMIN + ACCOUNTANT (par cohérence fiscale).
  @Get('fare-classes')
  @RequirePermission(Permission.FARE_CLASS_READ_TENANT)
  listFareClasses(@Param('tenantId') tenantId: string) {
    return this.fareClasses.list(tenantId);
  }

  @Post('fare-classes')
  @RequirePermission(Permission.FARE_CLASS_MANAGE_TENANT)
  createFareClass(
    @Param('tenantId') tenantId: string,
    @Body()            dto:      CreateTenantFareClassDto,
  ) {
    return this.fareClasses.create(tenantId, dto);
  }

  @Patch('fare-classes/:id')
  @RequirePermission(Permission.FARE_CLASS_MANAGE_TENANT)
  updateFareClass(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
    @Body()            dto:      UpdateTenantFareClassDto,
  ) {
    return this.fareClasses.update(tenantId, id, dto);
  }

  @Delete('fare-classes/:id')
  @RequirePermission(Permission.FARE_CLASS_MANAGE_TENANT)
  removeFareClass(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
  ) {
    return this.fareClasses.remove(tenantId, id);
  }

  // ── Payment config ─────────────────────────────────────────────────────────
  @Get('payment')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  getPayment(@Param('tenantId') tenantId: string) {
    return this.paymentConfig.get(tenantId);
  }

  @Patch('payment')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  updatePayment(@Param('tenantId') tenantId: string, @Body() dto: UpdatePaymentConfigDto) {
    return this.paymentConfig.update(tenantId, dto);
  }

  // ── Integrations API ───────────────────────────────────────────────────────
  @Get('integrations')
  @RequirePermission(Permission.INTEGRATION_SETUP_TENANT)
  listIntegrations(@Param('tenantId') tenantId: string) {
    return this.integrations.list(tenantId);
  }

  // Les routes PAYMENT restent sur le chemin historique (rétrocompatibilité
  // avec le frontend existant pour les providers paiement).
  @Patch('integrations/:providerKey')
  @RequirePermission(Permission.INTEGRATION_SETUP_TENANT)
  updateIntegrationMode(
    @Param('tenantId')    tenantId:    string,
    @Param('providerKey') providerKey: string,
    @Body()               dto:         UpdateIntegrationModeDto,
    @CurrentUser()        user:        CurrentUserPayload,
  ) {
    return this.integrations.updatePaymentMode(tenantId, providerKey, dto, user.id);
  }

  @Post('integrations/:providerKey/healthcheck')
  @RequirePermission(Permission.INTEGRATION_SETUP_TENANT)
  runHealthcheck(
    @Param('tenantId')    tenantId:    string,
    @Param('providerKey') providerKey: string,
  ) {
    return this.integrations.runPaymentHealthcheck(tenantId, providerKey);
  }

  // Routes OAuth dédiées — séparation claire car la logique d'activation diffère
  // (pas de supportedCurrencies/methods/countries, credentials Vault obligatoires
  // avant activation, healthcheck = présence Vault).
  @Patch('integrations/oauth/:providerKey')
  @RequirePermission(Permission.INTEGRATION_SETUP_TENANT)
  updateOAuthIntegrationMode(
    @Param('tenantId')    tenantId:    string,
    @Param('providerKey') providerKey: string,
    @Body()               dto:         UpdateIntegrationModeDto,
    @CurrentUser()        user:        CurrentUserPayload,
  ) {
    return this.integrations.updateOAuthMode(tenantId, providerKey, dto, user.id);
  }

  @Post('integrations/oauth/:providerKey/healthcheck')
  @RequirePermission(Permission.INTEGRATION_SETUP_TENANT)
  runOAuthHealthcheckRoute(
    @Param('tenantId')    tenantId:    string,
    @Param('providerKey') providerKey: string,
  ) {
    return this.integrations.runOAuthHealthcheck(tenantId, providerKey);
  }

  // ── BYO-credentials (tenant-scoped Vault) ─────────────────────────────────
  // GET  /integrations/:key/schema    → schéma des champs (sans secrets)
  // PUT  /integrations/:key/credentials → sauvegarde dans Vault tenants/<tid>/payments/<key>
  // DELETE /integrations/:key/credentials → supprime de Vault + revient à la config plateforme

  @Get('integrations/:providerKey/schema')
  @RequirePermission(Permission.INTEGRATION_SETUP_TENANT)
  getCredentialSchema(
    @Param('providerKey') providerKey: string,
  ) {
    return this.integrations.getCredentialSchema(providerKey);
  }

  @Put('integrations/:providerKey/credentials')
  @RequirePermission(Permission.INTEGRATION_SETUP_TENANT)
  saveCredentials(
    @Param('tenantId')    tenantId:    string,
    @Param('providerKey') providerKey: string,
    @Body()               dto:         SaveCredentialsDto,
    @CurrentUser()        user:        CurrentUserPayload,
  ) {
    return this.integrations.saveCredentials(tenantId, providerKey, dto, user.id);
  }

  @Delete('integrations/:providerKey/credentials')
  @RequirePermission(Permission.INTEGRATION_SETUP_TENANT)
  deleteCredentials(
    @Param('tenantId')    tenantId:    string,
    @Param('providerKey') providerKey: string,
  ) {
    return this.integrations.deleteCredentials(tenantId, providerKey);
  }
}
