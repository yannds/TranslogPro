/**
 * WhiteLabelController — CRUD marque blanche par tenant.
 *
 * Routes :
 *   GET    /api/v1/tenants/:tenantId/brand         — lecture publique (portail, Next.js SSR)
 *   PUT    /api/v1/tenants/:tenantId/brand         — upsert (control.settings.manage.tenant)
 *   DELETE /api/v1/tenants/:tenantId/brand         — remise aux défauts (control.settings.manage.tenant)
 *   GET    /api/v1/tenants/:tenantId/brand/style   — retourne le bloc <style> HTML prêt à injecter
 *   GET    /api/v1/tenants/:tenantId/brand/tokens  — retourne les tokens JSON (React ThemeProvider)
 */
import {
  Controller, Get, Put, Delete, Param, Body,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { WhiteLabelService }   from './white-label.service';
import { UpsertBrandDto }       from './dto/upsert-brand.dto';
import { RequirePermission }    from '../../common/decorators/require-permission.decorator';
import { Permission }           from '../../common/constants/permissions';

@Controller({ version: '1', path: 'tenants/:tenantId/brand' })
export class WhiteLabelController {
  constructor(private readonly service: WhiteLabelService) {}

  /** Lecture publique — utilisée par Next.js getServerSideProps pour le SSR */
  @Get()
  getBrand(@Param('tenantId') tenantId: string) {
    return this.service.getBrand(tenantId);
  }

  /** Bloc <style> prêt à injecter dans le <head> */
  @Get('style')
  async getStyleTag(@Param('tenantId') tenantId: string): Promise<{ style: string }> {
    const brand = await this.service.getBrand(tenantId);
    return { style: this.service.buildStyleTag(brand) };
  }

  /** Tokens JSON pour un ThemeProvider React */
  @Get('tokens')
  async getTokens(@Param('tenantId') tenantId: string) {
    const brand = await this.service.getBrand(tenantId);
    return this.service.buildThemeTokens(brand);
  }

  @Put()
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  upsert(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpsertBrandDto,
  ) {
    return this.service.upsert(tenantId, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  remove(@Param('tenantId') tenantId: string) {
    return this.service.remove(tenantId);
  }
}
