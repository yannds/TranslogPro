import { Module } from '@nestjs/common';
import { PlatformIamController } from './platform-iam.controller';
import { PlatformIamService }    from './platform-iam.service';
import { PasswordResetModule }   from '../password-reset/password-reset.module';

/**
 * PlatformIamModule — endpoints IAM cross-tenant pour le staff plateforme.
 * À distinguer de TenantIamModule (scopé par tenantId) et PlatformModule
 * (gestion du staff plateforme lui-même).
 */
@Module({
  imports:     [PasswordResetModule],
  controllers: [PlatformIamController],
  providers:   [PlatformIamService],
  exports:     [PlatformIamService],
})
export class PlatformIamModule {}
