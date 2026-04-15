import { Module } from '@nestjs/common';
import { MfaController } from './mfa.controller';
import { MfaService }    from './mfa.service';

@Module({
  controllers: [MfaController],
  providers:   [MfaService],
  exports:     [MfaService], // exporté pour qu'AuthService puisse l'utiliser le jour où on câble le flow login
})
export class MfaModule {}
