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
  Controller, Post, Get, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';
import { MfaService } from './mfa.service';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

/**
 * NB : décorateurs class-validator obligatoires — le ValidationPipe global
 * tourne avec `whitelist: true` + `forbidNonWhitelisted: true`. Sans
 * décorateurs, le champ est strippé du body et le service reçoit `undefined`,
 * ce qui se traduit par un 400 silencieux côté client (le bon code TOTP est
 * rejeté à tort). Couvre /enable et /disable.
 */
class VerifyCodeDto {
  @IsString()
  // 6 chiffres TOTP standard, ou backup code 8 hex (utilisé par /disable).
  @Length(6, 16)
  @Matches(/^[A-Za-z0-9]+$/)
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

  /**
   * Statut MFA self-service. Renvoie uniquement les flags non-sensibles
   * (jamais le secret). Consommé par PageAccount pour piloter l'UI.
   */
  @Get('status')
  status(@CurrentUser() user: CurrentUserPayload) {
    return this.mfa.getStatus(user.id);
  }

  /**
   * Rotation des codes de secours. Exige un code TOTP valide pour bloquer
   * un attaquant qui aurait volé le cookie de session.
   */
  @Post('backup-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  regenerateBackupCodes(
    @CurrentUser() user: CurrentUserPayload,
    @Body()        dto:  VerifyCodeDto,
  ) {
    return this.mfa.regenerateBackupCodes(user.id, dto.code);
  }
}
