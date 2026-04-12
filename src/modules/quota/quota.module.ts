import { Module, Global } from '@nestjs/common';
import { QuotaService } from './quota.service';

@Global()
@Module({
  providers: [QuotaService],
  exports:   [QuotaService],
})
export class QuotaModule {}
