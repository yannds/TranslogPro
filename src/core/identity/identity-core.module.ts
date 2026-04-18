/**
 * IdentityCoreModule — @Global module exposant AuthIdentityService.
 *
 * Distinct de `src/infrastructure/identity/identity.module.ts` (qui encapsule
 * BetterAuth). Ici on fournit des primitives tenant-scoped pour auth, oauth,
 * password-reset, tenant-iam — sans dépendre d'un provider externe.
 */

import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthIdentityService } from './auth-identity.service';

@Global()
@Module({
  imports:   [DatabaseModule],
  providers: [AuthIdentityService],
  exports:   [AuthIdentityService],
})
export class IdentityCoreModule {}
