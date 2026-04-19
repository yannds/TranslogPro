import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/constants/permissions';
import { TenantTaxService, CreateTenantTaxDto, UpdateTenantTaxDto } from './tenant-tax.service';
import { TenantPaymentConfigService, UpdatePaymentConfigDto } from './tenant-payment-config.service';
import { IntegrationsService, UpdateIntegrationModeDto } from './integrations.service';

/**
 * Regroupe 3 endpoints /settings côté tenant :
 *   - /tenants/:tenantId/settings/taxes       (CRUD TenantTax)
 *   - /tenants/:tenantId/settings/payment     (GET/PATCH TenantPaymentConfig)
 *   - /tenants/:tenantId/settings/integrations (GET + PATCH mode + POST healthcheck)
 *
 * Permission : SETTINGS_MANAGE_TENANT pour taxes/payment,
 *              INTEGRATION_SETUP_TENANT pour les integrations.
 *
 * Les secrets ne transitent JAMAIS par ces endpoints — uniquement via Vault.
 */
@Controller({ version: '1', path: 'tenants/:tenantId/settings' })
export class TenantSettingsController {
  constructor(
    private readonly taxes:         TenantTaxService,
    private readonly paymentConfig: TenantPaymentConfigService,
    private readonly integrations:  IntegrationsService,
  ) {}

  // ── Taxes ──────────────────────────────────────────────────────────────────
  @Get('taxes')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  listTaxes(@Param('tenantId') tenantId: string) {
    return this.taxes.list(tenantId);
  }

  @Post('taxes')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  createTax(@Param('tenantId') tenantId: string, @Body() dto: CreateTenantTaxDto) {
    return this.taxes.create(tenantId, dto);
  }

  @Patch('taxes/:id')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  updateTax(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTenantTaxDto,
  ) {
    return this.taxes.update(tenantId, id, dto);
  }

  @Delete('taxes/:id')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  removeTax(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.taxes.remove(tenantId, id);
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
}
