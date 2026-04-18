import { Module } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetController } from './password-reset.controller';

/**
 * PasswordResetModule — routes publiques "mot de passe oublié".
 *
 * Le service est exporté pour être réutilisé par TenantIamModule (reset
 * initié par un admin depuis la page IAM).
 */
@Module({
  controllers: [PasswordResetController],
  providers:   [PasswordResetService],
  exports:     [PasswordResetService],
})
export class PasswordResetModule {}
