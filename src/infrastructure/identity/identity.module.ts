import { Module, Global } from '@nestjs/common';
import { BetterAuthService } from './better-auth.service';
import { IDENTITY_SERVICE } from './interfaces/identity.interface';

@Global()
@Module({
  providers: [
    {
      provide:  IDENTITY_SERVICE,
      useClass: BetterAuthService,
    },
  ],
  exports: [IDENTITY_SERVICE],
})
export class IdentityModule {}
