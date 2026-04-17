import { Module } from '@nestjs/common';
import { TariffController } from './tariff.controller';
import { TariffService } from './tariff.service';

@Module({
  controllers: [TariffController],
  providers:   [TariffService],
  exports:     [TariffService],
})
export class TariffModule {}
