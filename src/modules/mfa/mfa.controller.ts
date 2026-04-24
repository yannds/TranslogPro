/**
 * MfaController — endpoints "self-service" MFA
 *
 * Routes :
 *   POST   /api/mfa/setup    → génère secret + QR (mfaEnabled reste false)
 *   POST   /api/mfa/enable   → vérifie code TOTP + active + renvoie backup codes
 *   POST   /api/mfa/disable  → désactive (code TOTP ou backup requis)
 *
 * Opère toujours sur l'utilisateur courant (`CurrentUser`). Il n'y a pas
 * d'endpoint "admin désactive le MFA d'un autre user" — c'est volontaire
 * (principe de self-sovereignty sur le second facteur). Un admin peut
 * néanmoins révoquer les sessions pour forcer une reconnexion.
 */
import {
  Controller, Post, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { MfaService } from './mfa.service';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

class VerifyCodeDto {
  code!: string;
}

@Controller({ version: '1', path: 'mfa' })
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  setup(@CurrentUser() user: CurrentUserPayload) {
    return this.mfa.setup(user.id);
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  enable(
    @CurrentUser() user: CurrentUserPayload,
    @Body()        dto:  VerifyCodeDto,
  ) {
    return this.mfa.enable(user.id, dto.code);
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  disable(
    @CurrentUser() user: CurrentUserPayload,
    @Body()        dto:  VerifyCodeDto,
  ) {
    return this.mfa.disable(user.id, dto.code);
  }
}
