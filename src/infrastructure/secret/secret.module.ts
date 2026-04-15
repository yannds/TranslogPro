import { Module, Global } from '@nestjs/common';
import { VaultService } from './vault.service';
import { SECRET_SERVICE } from './interfaces/secret.interface';

@Global()  // Disponible dans tous les modules sans import explicite
@Module({
  providers: [{ provide: SECRET_SERVICE, useClass: VaultService }],
  exports: [SECRET_SERVICE],  // token seulement — pas une 2e instance distincte
})
export class SecretModule {}
