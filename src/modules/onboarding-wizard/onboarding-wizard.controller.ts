import {
  Controller, Get, Post, Patch, Body, HttpCode, UseGuards,
} from '@nestjs/common';
import { OnboardingWizardService } from './onboarding-wizard.service';
import {
  UpdateBrandStepDto, UpdateAgencyStepDto, CreateFirstStationDto,
  CreateFirstRouteDto, InviteTeamStepDto,
} from './dto/onboarding-wizard.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import {
  RateLimit, RedisRateLimitGuard,
} from '../../common/guards/redis-rate-limit.guard';

/**
 * OnboardingWizardController — endpoints tenant-admin pour le wizard
 * post-signup (/onboarding).
 *
 * Tous les endpoints sont protégés par `SETTINGS_MANAGE_TENANT`. Le tenant
 * cible est toujours lu depuis la session (CurrentUser.tenantId) — jamais
 * depuis le path/body — pour prévenir toute escalade cross-tenant.
 *
 * Rate-limit : 20 req / 5 min / IP sur les POST/PATCH pour ralentir les abus,
 * sans bloquer un admin qui itère son wizard.
 */
@Controller({ version: '1', path: 'onboarding' })
@RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
export class OnboardingWizardController {
  constructor(private readonly service: OnboardingWizardService) {}

  @Get('state')
  state(@CurrentUser() user: CurrentUserPayload) {
    return this.service.getState(user.tenantId);
  }

  @Patch('brand')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 20, windowMs: 5 * 60_000, keyBy: 'ip', suffix: 'onb_brand' })
  updateBrand(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateBrandStepDto,
  ) {
    return this.service.updateBrand(user.tenantId, dto);
  }

  @Patch('agency')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 20, windowMs: 5 * 60_000, keyBy: 'ip', suffix: 'onb_agency' })
  renameAgency(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateAgencyStepDto,
  ) {
    return this.service.renameDefaultAgency(user.tenantId, dto);
  }

  @Post('station')
  @HttpCode(200) // idempotent : upsert de la première station
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 20, windowMs: 5 * 60_000, keyBy: 'ip', suffix: 'onb_station' })
  createFirstStation(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateFirstStationDto,
  ) {
    return this.service.createFirstStation(user.tenantId, dto);
  }

  @Post('route')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 20, windowMs: 5 * 60_000, keyBy: 'ip', suffix: 'onb_route' })
  createFirstRoute(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateFirstRouteDto,
  ) {
    return this.service.createFirstRoute(user.tenantId, dto);
  }

  @Post('invite')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 60 * 60_000, keyBy: 'ip', suffix: 'onb_invite' })
  inviteTeam(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: InviteTeamStepDto,
  ) {
    return this.service.inviteTeam(user.tenantId, dto);
  }

  @Post('complete')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 60 * 60_000, keyBy: 'ip', suffix: 'onb_complete' })
  complete(@CurrentUser() user: CurrentUserPayload) {
    return this.service.complete(user.tenantId);
  }
}
