import { Module, Global } from '@nestjs/common';
import { QuotaService } from './quota.service';
import { QuotaController } from './quota.controller';

@Global()
@Module({
  controllers: [QuotaController],
  providers:   [QuotaService],
  exports:     [QuotaService],
})
export class QuotaModule {}
